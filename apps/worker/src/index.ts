import { Worker, Job } from "bullmq";
import { pool } from "./db";
import { env } from "./env";
import { workerLog as log, installCrashLogging } from "../../api/src/logger";
import { EXECUTION_QUEUE_NAME, executionQueue } from "../../api/src/queue/executionQueue";
import { scheduleQueue, SCHEDULE_QUEUE_NAME } from "../../api/src/queue/scheduleQueue";
import { enqueueExecution } from "../../api/src/executions/enqueue";
import { getCronExpression } from "../../api/src/schedule/sync";
import { runWorkflow } from "../../api/src/engine";
import { workflowDefinitionSchema } from "../../api/src/dsl/schema";
import { validateWorkflowDefinition } from "../../api/src/dsl/validate";
import { installGracefulShutdown } from "../../api/src/shutdown";
import { pool as apiPool } from "../../api/src/db";
import { sweepOnce } from "./sweeper";

installCrashLogging(log);

interface ExecutionJobData {
  executionId: string;
}

async function markFailed(executionId: string, message: string) {
  await pool.query(
    `UPDATE executions
     SET status = 'failure', error = $2, finished_at = now(), started_at = COALESCE(started_at, now())
     WHERE id = $1 AND status IN ('pending', 'running')`,
    [executionId, message]
  );
}

const stepDuration = (startedAt: string, endedAt: string) =>
  new Date(endedAt).getTime() - new Date(startedAt).getTime();

const inFlight = new Set<string>();

async function processJob(job: Job<ExecutionJobData>) {
  const { executionId } = job.data;

  // Atomic claim: only one worker can move an execution from pending to running
  const claim = await pool.query<{
    tenant_id: string;
    workflow_id: string;
    trigger_payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `UPDATE executions SET status = 'running', started_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING tenant_id, workflow_id, trigger_payload, created_at`,
    [executionId]
  );
  const execution = claim.rows[0];
  if (!execution) {
    log.info({ executionId }, "execution not claimable (missing or already handled), skipping");
    return;
  }

  inFlight.add(executionId);

  const xlog = log.child({
    executionId,
    workflowId: execution.workflow_id,
    tenantId: execution.tenant_id,
  });
  const startedAtMs = Date.now();
  xlog.info({ queueWaitMs: startedAtMs - execution.created_at.getTime() }, "execution started");

  try {
    const workflowResult = await pool.query<{ definition: unknown }>(
      "SELECT definition FROM workflows WHERE id = $1",
      [execution.workflow_id]
    );
    const workflowRow = workflowResult.rows[0];
    if (!workflowRow) {
      await markFailed(executionId, "Workflow no longer exists");
      xlog.warn({ status: "failure", durationMs: Date.now() - startedAtMs }, "workflow no longer exists");
      return;
    }

    const validation = validateWorkflowDefinition(workflowRow.definition);
    if (!validation.valid) {
      await markFailed(executionId, `Invalid workflow definition: ${validation.errors.join("; ")}`);
      xlog.warn(
        { status: "failure", errors: validation.errors, durationMs: Date.now() - startedAtMs },
        "invalid workflow definition"
      );
      return;
    }
    const definition = workflowDefinitionSchema.parse(workflowRow.definition);

    const result = await runWorkflow(definition, execution.trigger_payload, {
      signal: AbortSignal.timeout(env.EXECUTION_TIMEOUT_MS),
      allowPrivateNetworks: env.ALLOW_PRIVATE_NETWORKS,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE executions SET status = $2, error = $3, finished_at = now() WHERE id = $1",
        [executionId, result.status, result.steps.find((s) => s.status === "failure")?.error ?? null]
      );
      for (const [index, step] of result.steps.entries()) {
        await client.query(
          `INSERT INTO execution_steps (execution_id, step_index, node_id, node_type, status, output, error, started_at, ended_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [executionId, index, step.nodeId, step.type, step.status, step.output ?? null, step.error ?? null, step.startedAt, step.endedAt]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    for (const step of result.steps) {
      const fields = {
        stepId: step.nodeId,
        nodeType: step.type,
        status: step.status,
        durationMs: stepDuration(step.startedAt, step.endedAt),
      };
      if (step.status === "failure") xlog.warn({ ...fields, error: step.error }, "step finished");
      else xlog.info(fields, "step finished");
    }

    const summary = { status: result.status, steps: result.steps.length, durationMs: Date.now() - startedAtMs };
    if (result.status === "success") xlog.info(summary, "execution finished");
    else xlog.warn(summary, "execution finished");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    xlog.error({ err, durationMs: Date.now() - startedAtMs }, "execution errored");
    await markFailed(executionId, `Worker error: ${message}`);
  } finally {
    inFlight.delete(executionId);
  }
}

const worker = new Worker<ExecutionJobData>(EXECUTION_QUEUE_NAME, processJob, {
  connection: { url: env.REDIS_URL },
  concurrency: 5,
  maxStalledCount: 0, // a job whose worker died is failed, not silently re-run
});

worker.on("error", (err) => {
  log.error({ err }, "execution worker error");
});

worker.on("failed", async (job, err) => {
  const executionId = job?.data?.executionId;
  log.error({ jobId: job?.id, executionId, err }, "job failed");
  if (executionId) {
    try {
      await markFailed(executionId, `Job failed: ${err.message}`);
    } catch (dbErr) {
      log.error({ err: dbErr, executionId }, "could not mark execution failed");
    }
  }
});

async function processTick(job: Job<{ workflowId: string }>) {
  const { workflowId } = job.data;

  const found = await pool.query<{ id: string; tenant_id: string; is_active: boolean; definition: unknown }>(
    "SELECT id, tenant_id, is_active, definition FROM workflows WHERE id = $1",
    [workflowId]
  );
  const wf = found.rows[0];

  if (!wf || !wf.is_active || !getCronExpression(wf.definition)) {
    await scheduleQueue.removeJobScheduler(`wf:${workflowId}`);
    log.info({ workflowId }, "removed stale scheduler");
    return;
  }

  const result = await enqueueExecution({
    tenantId: wf.tenant_id,
    workflowId: wf.id,
    payload: { trigger: "cron", firedAt: new Date().toISOString() },
    idempotencyKey: `cron:${job.id}`,
  });
  log.info(
    { workflowId, tenantId: wf.tenant_id, executionId: result.executionId, duplicate: result.duplicate },
    "schedule fired"
  );
}

const scheduleWorker = new Worker(SCHEDULE_QUEUE_NAME, processTick, {
  connection: { url: env.REDIS_URL },
  concurrency: 5,
});

scheduleWorker.on("error", (err) => {
  log.error({ err }, "schedule worker error");
});

scheduleWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err }, "schedule tick failed");
});

if (env.ALLOW_PRIVATE_NETWORKS) {
  log.warn("private network access is ENABLED for HTTP actions (development only)");
}

log.info({ executionTimeoutMs: env.EXECUTION_TIMEOUT_MS }, "worker listening for execution and schedule jobs");

let sweeping = false;
const sweepTimer = setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    const result = await sweepOnce({
      pendingAfterMs: env.PENDING_SWEEP_AFTER_MS,
      runningAfterMs: env.EXECUTION_TIMEOUT_MS + 60_000,
    });
    if (result.requeued > 0 || result.failedRunning > 0) log.info(result, "sweep finished");
  } catch (err) {
    log.error({ err }, "sweep failed");
  } finally {
    sweeping = false;
  }
}, env.SWEEP_INTERVAL_MS);

installGracefulShutdown({
  log,
  timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
  steps: [
    { name: "sweeper", run: async () => clearInterval(sweepTimer) },
    // Stops taking new jobs and waits for the running ones to finish.
    { name: "workers", run: () => Promise.all([worker.close(), scheduleWorker.close()]) },
    { name: "queues", run: () => Promise.all([executionQueue.close(), scheduleQueue.close()]) },
    { name: "postgres", run: () => Promise.all([pool.end(), apiPool.end()]) },
  ],
  onTimeout: async () => {
    await Promise.all(
      [...inFlight].map((id) => markFailed(id, "Worker shut down before the execution finished"))
    );
  },
});