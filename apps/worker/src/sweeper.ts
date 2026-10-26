import { pool } from "./db";
import { workerLog as log } from "../../api/src/logger";
import { executionQueue } from "../../api/src/queue/executionQueue";

export interface SweepOptions {
  pendingAfterMs: number;
  runningAfterMs: number;
}

export interface SweepResult {
  requeued: number;
  failedRunning: number;
}

export async function sweepOnce(opts: SweepOptions): Promise<SweepResult> {
  // 1. Pending executions that were never picked up.
  const pending = await pool.query<{ id: string; tenant_id: string; workflow_id: string }>(
    `SELECT id, tenant_id, workflow_id FROM executions
     WHERE status = 'pending' AND created_at < now() - ($1::int * interval '1 millisecond')
     ORDER BY created_at
     LIMIT 100`,
    [opts.pendingAfterMs]
  );

  let requeued = 0;
  for (const row of pending.rows) {
    try {
      const existing = await executionQueue.getJob(row.id);
      if (existing) {
        const state = await existing.getState();
        // Still waiting, delayed, or being worked on: leave it alone.
        if (state !== "failed" && state !== "completed") continue;
        // A dead job still holds the ID, and BullMQ ignores an add for an existing ID.
        await existing.remove();
      }
      await executionQueue.add("execute", { executionId: row.id }, { jobId: row.id });
      requeued++;
      log.warn(
        { executionId: row.id, tenantId: row.tenant_id, workflowId: row.workflow_id },
        "re-queued stuck pending execution"
      );
    } catch (err) {
      log.error({ err, executionId: row.id }, "could not re-queue pending execution");
    }
  }

  // 2. Running executions whose worker disappeared (a healthy run ends within the job timeout).
  const lost = await pool.query<{ id: string; tenant_id: string; workflow_id: string }>(
    `UPDATE executions
     SET status = 'failure', error = $2, finished_at = now()
     WHERE status = 'running' AND started_at < now() - ($1::int * interval '1 millisecond')
     RETURNING id, tenant_id, workflow_id`,
    [opts.runningAfterMs, "Execution lost: the worker stopped before it finished"]
  );
  for (const row of lost.rows) {
    log.warn(
      { executionId: row.id, tenantId: row.tenant_id, workflowId: row.workflow_id },
      "failed lost running execution"
    );
  }

  return { requeued, failedRunning: lost.rowCount ?? 0 };
}