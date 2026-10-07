import { Worker, Job } from "bullmq";
import { z } from "zod";
import { pool } from "./db";
import { env } from "./env";
import { EXECUTION_QUEUE_NAME } from "../../api/src/queue/executionQueue";
import { runWorkflow } from "../../api/src/engine";
import { workflowDefinitionSchema } from "../../api/src/dsl/schema";

interface ExecutionJobData {
    executionId: string;
}

async function processJob(job: Job<ExecutionJobData>) {
    const { executionId } = job.data;
    console.log(`[worker] starting execution ${executionId}`);

    const execResult = await pool.query<{
        id: string;
        workflow_id: string;
        trigger_payload: Record<string, unknown>;
    }>("SELECT id, workflow_id, trigger_payload FROM executions WHERE id = $1", [executionId]);

    const execution = execResult.rows[0];
    if (!execution) {
        console.error(`[worker] execution ${executionId} now found, skipping`);
        return;
    }

    const workflowResult = await pool.query<{ definition: unknown }>(
        "SELECT definition FROM workflows WHERE id = $1",
        [execution.workflow_id]
    );
    const workflowRow = workflowResult.rows[0];
    if (!workflowRow) {
        await pool.query(
            "UPDATE executions SET status = 'failure', error = $2, started_at = now(), finished_at = now() WHERE id = $1",
            [executionId, "Workflow no longer exists"]
        );
        return;
    }

    const definition = workflowDefinitionSchema.parse(workflowRow.definition);

    await pool.query("UPDATE executions SET status = 'running', started_at = now() WHERE id = $1", [executionId]);

    const result = await runWorkflow(definition, execution.trigger_payload);

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            "UPDATE executions SET status = $2, error = $3, finished_at = now() WHERE id = $1",
            [executionId, result.status, result.steps.find((s) => s.status === "failure")?.error ?? null]
        );
        for (const step of result.steps) {
            await client.query(
                `INSERT INTO execution_steps (execution_id, node_id, node_type, status, output, error, started_at, ended_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [executionId, step.nodeId, step.type, step.status, step.output ?? null, step.error ?? null, step.startedAt, step.endedAt]
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
}

const worker = new Worker(EXECUTION_QUEUE_NAME, processJob, {
    connection: { url: env.REDIS_URL },
    concurrency: 5,
});

worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
});

console.log("[worker] listening for execution jobs...");
