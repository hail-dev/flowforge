import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { executionQueue } from "../queue/executionQueue";

export const executeRouter = Router();
executeRouter.use(requireAuth);

const executeSchema = z.object({
    payload: z.record(z.string(), z.any()).default({})
});

executeRouter.post("/:id/execute", async (req: AuthedRequest, res) => {
    const parsed = executeSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const tenantId = req.auth!.tenantId;
    const workflowId = req.params.id;

    const workflowResult = await pool.query(
        "SELECT id FROM workflows WHERE id = $1 AND tenant_id = $2",
        [workflowId, tenantId]
    );
    if (workflowResult.rows.length === 0) {
        return res.status(404).json({ error: "Workflow not found" });
    }

    const executionResult = await pool.query<{ id: string }>(
        `INSERT INTO executions (tenant_id, workflow_id, status, trigger_payload)
        VALUES ($1, $2, 'pending', $3)
        RETURNING id`,
        [tenantId, workflowId, parsed.data.payload]
    );
    const executionId = executionResult.rows[0].id;

    await executionQueue.add("execute", { executionId }, { jobId: executionId});

    res.status(202).json({ executionId, status: "pending" });
});