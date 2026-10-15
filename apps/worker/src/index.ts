import { Worker, Job } from "bullmq";
import { pool } from "./db";
import { env } from "./env";
import { EXECUTION_QUEUE_NAME } from "../../api/src/queue/executionQueue";
import { runWorkflow } from "../../api/src/engine";
import { workflowDefinitionSchema } from "../../api/src/dsl/schema";
import { validateWorkflowDefinition } from "../../api/src/dsl/validate";
import { scheduleQueue, SCHEDULE_QUEUE_NAME } from "../../api/src/queue/scheduleQueue";
import { enqueueExecution } from "../../api/src/executions/enqueue";
import { getCronExpression } from "../../api/src/schedule/sync";

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

async function processJob(job: Job<ExecutionJobData>) {
  const { executionId } = job.data;

  // atomic claim: only one worker can move an execution from pending to running
  const claim = await pool.query<{ workflow_id: string; trigger_payload: Record<string, unknown> }>(
    `UPDATE executions SET status = 'running', started_at = now()
     WHERE id = $1 AND status = 'pending'
     RETURNING workflow_id, trigger_payload`,
    [executionId]
  );
  const execution = claim.rows[0];
  if (!execution) {
    console.log(`[worker] execution ${executionId} not claimable (missing or already handled), skipping`);
    return;
  }

  console.log(`[worker] starting execution ${executionId}`);

  try {
    const workflowResult = await pool.query<{ definition: unknown }>(
      "SELECT definition FROM workflows WHERE id = $1",
      [execution.workflow_id]
    );
    const workflowRow = workflowResult.rows[0];
    if (!workflowRow) {
      await markFailed(executionId, "Workflow no longer exists");
      return;
    }

    const validation = validateWorkflowDefinition(workflowRow.definition);
    if (!validation.valid) {
      await markFailed(executionId, `Invalid workflow definition: ${validation.errors.join("; ")}`);
      return;
    }
    const definition = workflowDefinitionSchema.parse(workflowRow.definition);

    const result = await runWorkflow(definition, execution.trigger_payload, {
      signal: AbortSignal.timeout(env.EXECUTION_TIMEOUT_MS),
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

    console.log(`[worker] execution ${executionId} finished: ${result.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] execution ${executionId} errored:`, message);
    await markFailed(executionId, `Worker error: ${message}`);
  }
}

const worker = new Worker<ExecutionJobData>(EXECUTION_QUEUE_NAME, processJob, {
  connection: { url: env.REDIS_URL },
  concurrency: 5,
  maxStalledCount: 0, // a job whose worker died is failed, not silently re-run
});

worker.on("failed", async (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
  const executionId = job?.data?.executionId;
  if (executionId) {
    try {
      await markFailed(executionId, `Job failed: ${err.message}`);
    } catch (dbErr) {
      console.error("[worker] could not mark execution failed:", dbErr);
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
    console.log(`[schedule] removed stale scheduler for workflow ${workflowId}`);
    return;
  }

  const result = await enqueueExecution({
    tenantId: wf.tenant_id,
    workflowId: wf.id,
    payload: { trigger: "cron", firedAt: new Date().toISOString() },
    idempotencyKey: `cron:${job.id}`,
  });
  console.log(`[schedule] workflow ${workflowId} fired -> execution ${result.executionId}`);
}

const scheduleWorker = new Worker(SCHEDULE_QUEUE_NAME, processTick, {
  connection: { url: env.REDIS_URL },
  concurrency: 5,
});

scheduleWorker.on("failed", (job, err) => {
  console.error(`[schedule] tick ${job?.id} failed:`, err.message);
});

console.log("[worker] listening for execution jobs...");