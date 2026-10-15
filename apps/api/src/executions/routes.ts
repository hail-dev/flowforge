import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";

export const executionsRouter = Router();
executionsRouter.use(requireAuth);

const listQuery = z.object({
  workflowId: z.string().uuid().optional(),
  status: z.enum(["pending", "running", "success", "failure"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

executionsRouter.get("/", async (req: AuthedRequest, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { workflowId, status, limit, offset } = parsed.data;
  const tenantId = req.auth!.tenantId;

  const result = await pool.query(
    `SELECT e.id, e.workflow_id, w.name AS workflow_name, e.status, e.error,
            e.created_at, e.started_at, e.finished_at,
            (EXTRACT(EPOCH FROM (e.finished_at - e.started_at)) * 1000)::int AS duration_ms
     FROM executions e
     JOIN workflows w ON w.id = e.workflow_id AND w.tenant_id = e.tenant_id
     WHERE e.tenant_id = $1
       AND ($2::uuid IS NULL OR e.workflow_id = $2)
       AND ($3::text IS NULL OR e.status = $3)
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $4 OFFSET $5`,
    [tenantId, workflowId ?? null, status ?? null, limit, offset]
  );
  res.json({ items: result.rows, limit, offset });
});

const idSchema = z.string().uuid();

executionsRouter.get("/:id", async (req: AuthedRequest, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) {
    return res.status(404).json({ error: "Execution not found" });
  }
  const tenantId = req.auth!.tenantId;

  const execution = await pool.query(
    `SELECT e.id, e.workflow_id, w.name AS workflow_name, e.status, e.error,
            e.trigger_payload, e.idempotency_key,
            e.created_at, e.started_at, e.finished_at,
            (EXTRACT(EPOCH FROM (e.finished_at - e.started_at)) * 1000)::int AS duration_ms
     FROM executions e
     JOIN workflows w ON w.id = e.workflow_id AND w.tenant_id = e.tenant_id
     WHERE e.id = $1 AND e.tenant_id = $2`,
    [id.data, tenantId]
  );
  if (execution.rows.length === 0) {
    return res.status(404).json({ error: "Execution not found" });
  }

  const steps = await pool.query(
    `SELECT step_index, node_id, node_type, status, output, error, started_at, ended_at,
            (EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::int AS duration_ms
     FROM execution_steps
     WHERE execution_id = $1
     ORDER BY step_index NULLS LAST, started_at, ended_at`,
    [id.data]
  );

  res.json({ ...execution.rows[0], steps: steps.rows });
});