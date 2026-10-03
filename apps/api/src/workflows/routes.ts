import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { create } from "node:domain";
import { validateWorkflowDefinition } from "../dsl/validate";

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

const createSchema = z.object({
    name: z.string().min(1).max(200),
    definition: z.record(z.string(), z.any()).default({}),
});

const updateSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    definition: z.record(z.string(), z.any()).optional(),
    isActive: z.boolean().optional(),
});

// CREATE
workflowsRouter.post("/", async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { name, definition } = parsed.data;
    const tenantId = req.auth!.tenantId;
    const validation = validateWorkflowDefinition(definition);
    if (!validation.valid) {
        return res.status(400).json({ error: "Invalid workflow definition", details: validation.errors});
    }

    const result = await pool.query(
        `INSERT INTO workflows (tenant_id, name, definition)
        VALUES ($1, $2, $3)
        RETURNING id, name, definition, is_active, created_at, updated_at`,
        [tenantId, name, definition]
    );
    res.status(201).json(result.rows[0]);
});

// LIST
workflowsRouter.get("/", async (req: AuthedRequest, res) => {
    const tenantId = req.auth!.tenantId;
    const result = await pool.query(
        `SELECT id, name, is_active, created_at, updated_at
        FROM workflows WHERE tenant_id = $1
        ORDER BY created_at DESC`,
        [tenantId]
    );
    res.json(result.rows);
});

// READ ONE
workflowsRouter.get("/:id", async (req: AuthedRequest, res) => {
    const tenantId = req.auth!.tenantId;
    const result = await pool.query(
        `SELECT id, name, definition, is_active, created_at, updated_at
        FROM workflows WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId]
    );
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "Workflow not found"});
    }
    res.json(result.rows[0]);
});

// UPDATE
workflowsRouter.put("/:id", async (req: AuthedRequest, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const tenantId = req.auth!.tenantId;
    const {name, definition, isActive} = parsed.data;
    if (definition !== undefined) {
        const validation = validateWorkflowDefinition(definition);
        if (!validation.valid) {
            return res.status(400).json({ error: "Invalid workflow definition", details: validation.errors });
        }
    }

    if (name === undefined && definition === undefined && isActive === undefined) {
        return res.status(400).json({ error: "No fields to update" });
    }

    const result = await pool.query(
        `UPDATE workflows
        SET name = COALESCE($1, name),
            definition = COALESCE($2, definition),
            is_active = COALESCE($3, is_active),
            updated_at = now()
        WHERE id = $4 AND tenant_id = $5
        RETURNING id, name, definition, is_active, created_at, updated_at`,
        [name ?? null, definition ?? null, isActive ?? null, req.params.id, tenantId]
    );
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "Workflow not found" });
    }
    res.json(result.rows[0]);
});

// DELETE
workflowsRouter.delete("/:id", async (req: AuthedRequest, res) => {
    const tenantId = req.auth!.tenantId;
    const result = await pool.query(
        `DELETE FROM workflows WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [req.params.id, tenantId]
    );
    if (result.rows.length === 0) {
        return res.status(404).json({ error: " Workflow not found" });
    }
    res.status(204).send();
});