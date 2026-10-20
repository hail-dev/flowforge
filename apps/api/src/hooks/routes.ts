import { Router } from "express";
import { pool } from "../db";
import { enqueueExecution } from "../executions/enqueue";
import { hookIpLimiter, hookSecretLimiter } from "../rateLimiters";

export const hooksRouter = Router();

// Public: no requireAuth. The secret in the URL is the credential.
hooksRouter.post("/:secret", hookIpLimiter, hookSecretLimiter, async (req, res) => {
  const { secret } = req.params;
  if (typeof secret !== "string" || !/^[a-f0-9]{48}$/.test(secret)) {
    return res.status(404).json({ error: "Not found" });
  }

  const body = req.body ?? {};
  if (typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Body must be a JSON object" });
  }

  const idempotencyKey = req.header("Idempotency-Key") ?? null;
  if (idempotencyKey !== null && (idempotencyKey.length === 0 || idempotencyKey.length > 200)) {
    return res.status(400).json({ error: "Idempotency-Key must be 1-200 characters" });
  }

  const found = await pool.query<{ id: string; tenant_id: string; definition: any }>(
    "SELECT id, tenant_id, definition FROM workflows WHERE webhook_secret = $1 AND is_active = true",
    [secret]
  );
  const workflow = found.rows[0];
  if (!workflow) {
    return res.status(404).json({ error: "Not found" });
  }

  const trigger = Array.isArray(workflow.definition?.nodes)
    ? workflow.definition.nodes.find((n: any) => n.type === "trigger")
    : undefined;
  if (trigger?.config?.kind !== "webhook") {
    return res.status(409).json({ error: "Workflow trigger is not a webhook" });
  }

  const result = await enqueueExecution({
    tenantId: workflow.tenant_id,
    workflowId: workflow.id,
    payload: body,
    idempotencyKey,
  });

  if (result.duplicate) {
    return res.status(200).json({ executionId: result.executionId, status: result.status, duplicate: true });
  }
  res.status(202).json({ executionId: result.executionId, status: "pending" });
});