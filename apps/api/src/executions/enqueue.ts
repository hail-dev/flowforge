import { pool } from "../db";
import { executionQueue } from "../queue/executionQueue";

export interface EnqueueInput {
  tenantId: string;
  workflowId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
}

export interface EnqueueResult {
  executionId: string;
  status: string;
  duplicate: boolean;
}

export async function enqueueExecution(input: EnqueueInput): Promise<EnqueueResult> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO executions (tenant_id, workflow_id, status, trigger_payload, idempotency_key)
     VALUES ($1, $2, 'pending', $3, $4)
     ON CONFLICT (workflow_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [input.tenantId, input.workflowId, input.payload, input.idempotencyKey]
  );

  if (inserted.rows.length === 0) {
    const existing = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM executions
       WHERE workflow_id = $1 AND idempotency_key = $2 AND tenant_id = $3`,
      [input.workflowId, input.idempotencyKey, input.tenantId]
    );
    return { executionId: existing.rows[0].id, status: existing.rows[0].status, duplicate: true };
  }

  const executionId = inserted.rows[0].id;
  await executionQueue.add("execute", { executionId }, { jobId: executionId });
  return { executionId, status: "pending", duplicate: false };
}