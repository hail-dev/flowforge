import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Mocked at the edges: no Redis, no real queue, no real scheduler. Everything else is real.
vi.mock("../rateLimiters", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    loginLimiter: pass,
    registerLimiter: pass,
    hookIpLimiter: pass,
    hookSecretLimiter: pass,
    executeLimiter: pass,
  };
});
vi.mock("../schedule/sync", () => ({
  syncSchedule: vi.fn(async () => {}),
  removeSchedule: vi.fn(async () => {}),
}));
vi.mock("../queue/executionQueue", () => ({
  EXECUTION_QUEUE_NAME: "workflow-execution",
  executionQueue: { add: vi.fn(async () => ({})) },
}));

import { pool } from "../db";
import { authRouter } from "../auth/routes";
import { workflowsRouter } from "../workflows/routes";
import { executeRouter } from "../workflows/executeRoute";
import { hooksRouter } from "../hooks/routes";
import { executionsRouter } from "../executions/routes";
import { executionQueue } from "../queue/executionQueue";

type Account = { email: string; token: string; tenantId: string };

const webhookTrigger = { id: "trigger-1", type: "trigger", config: { kind: "webhook" } };
const httpAction = {
  id: "action-1",
  type: "action",
  config: { kind: "http_request", url: "https://example.com/hook", method: "POST" },
};
const validDefinition = { nodes: [webhookTrigger, httpAction], edges: [{ source: "trigger-1", target: "action-1" }] };
const cronDefinition = {
  nodes: [{ id: "trigger-1", type: "trigger", config: { kind: "cron", expression: "*/5 * * * *" } }],
  edges: [],
};

let server: Server | undefined;
let baseUrl = "";
const createdTenantIds: string[] = [];
let A: Account;
let B: Account;
let wfA: string;

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body
  }
  return { status: res.status, json };
}

async function register(label: string): Promise<Account> {
  const email = `${label}-${randomUUID()}@test.local`;
  const r = await call("POST", "/auth/register", {
    body: { tenantName: `Test ${label}`, email, password: "test-password-123" },
  });
  expect(r.status).toBe(201);
  const t = await pool.query<{ tenant_id: string }>("SELECT tenant_id FROM users WHERE email = $1", [email]);
  createdTenantIds.push(t.rows[0].tenant_id);
  return { email, token: r.json.token as string, tenantId: t.rows[0].tenant_id };
}

async function createWorkflow(token: string, name: string, definition: unknown = validDefinition) {
  const r = await call("POST", "/workflows", { token, body: { name, definition } });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

async function webhookSecret(token: string, workflowId: string) {
  const r = await call("GET", `/workflows/${workflowId}`, { token });
  return r.json.webhook_secret as string;
}

const activate = (token: string, workflowId: string, isActive = true) =>
  call("PUT", `/workflows/${workflowId}`, { token, body: { isActive } });

const execute = (token: string, workflowId: string, key?: string) =>
  call("POST", `/workflows/${workflowId}/execute`, {
    token,
    body: { payload: { amount: 150 } },
    headers: key ? { "Idempotency-Key": key } : undefined,
  });

async function executionCount(workflowId: string) {
  const r = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM executions WHERE workflow_id = $1", [
    workflowId,
  ]);
  return r.rows[0].n;
}

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://invalid").pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run: DATABASE_URL points at "${dbName}", not a *_test database`);
  }
  try {
    await pool.query("SELECT 1 FROM tenants LIMIT 1");
  } catch (err) {
    throw new Error(
      `Test database is not ready (create flowforge_test and run the migrations): ${(err as Error).message}`
    );
  }

  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  app.use("/workflows", workflowsRouter);
  app.use("/workflows", executeRouter);
  app.use("/hooks", hooksRouter);
  app.use("/executions", executionsRouter);
  const s = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  server = s;
  baseUrl = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

  A = await register("a");
  B = await register("b");
  wfA = await createWorkflow(A.token, "A workflow");
}, 30_000);

afterAll(async () => {
  if (createdTenantIds.length > 0) {
    await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [createdTenantIds]);
  }
  if (server) {
    const s = server;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  await pool.end();
});

describe("auth", () => {
  it("rejects requests without a token", async () => {
    expect((await call("GET", "/workflows")).status).toBe(401);
    expect((await call("GET", "/executions")).status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const r = await call("GET", "/workflows", { token: "garbage" });
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("Invalid or expired token");
  });

  it("rejects a duplicate email", async () => {
    const r = await call("POST", "/auth/register", {
      body: { tenantName: "Dup", email: A.email, password: "test-password-123" },
    });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("Email already registered");
  });

  it("logs in with the right password and rejects the wrong one", async () => {
    const bad = await call("POST", "/auth/login", { body: { email: A.email, password: "wrong-password" } });
    expect(bad.status).toBe(401);
    expect(bad.json.error).toBe("Invalid email or password");
    const good = await call("POST", "/auth/login", { body: { email: A.email, password: "test-password-123" } });
    expect(good.status).toBe(200);
    expect(typeof good.json.token).toBe("string");
  });

  it("rejects a short password", async () => {
    const r = await call("POST", "/auth/register", {
      body: { tenantName: "Short", email: `short-${randomUUID()}@test.local`, password: "short" },
    });
    expect(r.status).toBe(400);
  });
});

describe("workflows", () => {
  it("creates a workflow that starts inactive", async () => {
    const r = await call("POST", "/workflows", { token: A.token, body: { name: "Created", definition: validDefinition } });
    expect(r.status).toBe(201);
    expect(r.json.name).toBe("Created");
    expect(r.json.is_active).toBe(false);
  });

  it("rejects invalid definitions with details", async () => {
    const twoTriggers = {
      nodes: [webhookTrigger, { ...webhookTrigger, id: "trigger-2" }],
      edges: [],
    };
    const r = await call("POST", "/workflows", { token: A.token, body: { name: "Bad", definition: twoTriggers } });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("Invalid workflow definition");
    expect(r.json.details.join(" ")).toContain("exactly one trigger");
    const empty = await call("POST", "/workflows", { token: A.token, body: { name: "Empty", definition: {} } });
    expect(empty.status).toBe(400);
  });

  it("updates a name, and rejects an invalid definition or an empty update", async () => {
    const id = await createWorkflow(A.token, "Before");
    const renamed = await call("PUT", `/workflows/${id}`, { token: A.token, body: { name: "After" } });
    expect(renamed.status).toBe(200);
    expect(renamed.json.name).toBe("After");
    const bad = await call("PUT", `/workflows/${id}`, { token: A.token, body: { definition: { nodes: [], edges: [] } } });
    expect(bad.status).toBe(400);
    const none = await call("PUT", `/workflows/${id}`, { token: A.token, body: {} });
    expect(none.status).toBe(400);
  });
});

describe("tenant isolation", () => {
  it("hides one tenant's workflows from another", async () => {
    const r = await call("GET", "/workflows", { token: B.token });
    expect(r.status).toBe(200);
    expect(r.json).toEqual([]);
  });

  it("blocks another tenant from reading, changing, deleting or running a workflow", async () => {
    const before = await executionCount(wfA);
    expect((await call("GET", `/workflows/${wfA}`, { token: B.token })).status).toBe(404);
    expect((await call("PUT", `/workflows/${wfA}`, { token: B.token, body: { name: "hijacked" } })).status).toBe(404);
    expect((await call("DELETE", `/workflows/${wfA}`, { token: B.token })).status).toBe(404);
    expect((await execute(B.token, wfA)).status).toBe(404);
    expect(await executionCount(wfA)).toBe(before);
    const own = await call("GET", `/workflows/${wfA}`, { token: A.token });
    expect(own.status).toBe(200);
    expect(own.json.name).toBe("A workflow");
  });

  it("hides one tenant's executions from another", async () => {
    const run = await execute(A.token, wfA);
    expect(run.status).toBe(202);
    const listB = await call("GET", "/executions?limit=100", { token: B.token });
    expect(listB.status).toBe(200);
    expect(listB.json.items).toEqual([]);
    expect((await call("GET", `/executions/${run.json.executionId}`, { token: B.token })).status).toBe(404);
  });

  it("lets the owner read their own execution", async () => {
    const run = await execute(A.token, wfA);
    const r = await call("GET", `/executions/${run.json.executionId}`, { token: A.token });
    expect(r.status).toBe(200);
    expect(r.json.workflow_id).toBe(wfA);
    expect(r.json.status).toBe("pending");
  });
});

describe("idempotency", () => {
  it("returns the original execution for a repeated Idempotency-Key", async () => {
    const wf = await createWorkflow(A.token, "idem");
    vi.mocked(executionQueue.add).mockClear();
    const first = await execute(A.token, wf, "order-1001");
    const second = await execute(A.token, wf, "order-1001");
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(second.json.executionId).toBe(first.json.executionId);
    expect(await executionCount(wf)).toBe(1);
    expect(executionQueue.add).toHaveBeenCalledTimes(1);
    expect(executionQueue.add).toHaveBeenCalledWith(
      "execute",
      { executionId: first.json.executionId },
      { jobId: first.json.executionId }
    );
  });

  it("creates a new execution every time when no key is sent", async () => {
    const wf = await createWorkflow(A.token, "no-key");
    const one = await execute(A.token, wf);
    const two = await execute(A.token, wf);
    expect(one.status).toBe(202);
    expect(two.status).toBe(202);
    expect(one.json.executionId).not.toBe(two.json.executionId);
    expect(await executionCount(wf)).toBe(2);
  });

  it("does not collide on the same key across different workflows", async () => {
    const wf1 = await createWorkflow(A.token, "idem-1");
    const wf2 = await createWorkflow(A.token, "idem-2");
    expect((await execute(A.token, wf1, "shared-key")).status).toBe(202);
    expect((await execute(A.token, wf2, "shared-key")).status).toBe(202);
  });

  it("rejects an over-long key", async () => {
    const r = await execute(A.token, wfA, "x".repeat(201));
    expect(r.status).toBe(400);
  });
});

describe("webhook trigger", () => {
  let wf: string;
  let secret: string;

  beforeAll(async () => {
    wf = await createWorkflow(A.token, "hooked");
    secret = await webhookSecret(A.token, wf);
    expect((await activate(A.token, wf)).status).toBe(200);
  });

  it("answers 404 while the workflow is inactive", async () => {
    const off = await createWorkflow(A.token, "hook-off");
    const offSecret = await webhookSecret(A.token, off);
    const r = await call("POST", `/hooks/${offSecret}`, { body: { amount: 150 } });
    expect(r.status).toBe(404);
    expect(await executionCount(off)).toBe(0);
  });

  it("queues an execution with the posted payload when active", async () => {
    vi.mocked(executionQueue.add).mockClear();
    const r = await call("POST", `/hooks/${secret}`, { body: { amount: 150, customer: "acme" } });
    expect(r.status).toBe(202);
    expect(executionQueue.add).toHaveBeenCalledTimes(1);
    const row = await pool.query("SELECT trigger_payload, tenant_id FROM executions WHERE id = $1", [
      r.json.executionId,
    ]);
    expect(row.rows[0].trigger_payload).toEqual({ amount: 150, customer: "acme" });
    expect(row.rows[0].tenant_id).toBe(A.tenantId);
  });

  it("returns the original execution for a repeated Idempotency-Key", async () => {
    const headers = { "Idempotency-Key": "evt-42" };
    const first = await call("POST", `/hooks/${secret}`, { body: { amount: 50 }, headers });
    const second = await call("POST", `/hooks/${secret}`, { body: { amount: 50 }, headers });
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(second.json.executionId).toBe(first.json.executionId);
  });

  it("rejects unknown secrets and array bodies", async () => {
    expect((await call("POST", "/hooks/not-a-real-secret", { body: {} })).status).toBe(404);
    expect((await call("POST", `/hooks/${"0".repeat(48)}`, { body: {} })).status).toBe(404);
    expect((await call("POST", `/hooks/${secret}`, { body: [1, 2] })).status).toBe(400);
  });

  it("refuses a webhook call to a cron-triggered workflow", async () => {
    const cron = await createWorkflow(A.token, "cron-flow", cronDefinition);
    const cronSecret = await webhookSecret(A.token, cron);
    expect((await activate(A.token, cron)).status).toBe(200);
    const r = await call("POST", `/hooks/${cronSecret}`, { body: {} });
    expect(r.status).toBe(409);
  });
});

describe("execution history API", () => {
  it("returns steps in step_index order even when timestamps tie", async () => {
    const wf = await createWorkflow(A.token, "steps");
    const run = await execute(A.token, wf);
    const execId = run.json.executionId as string;
    const ts = "2026-01-01T00:00:00Z";
    for (const [index, node] of [[2, "c"], [0, "a"], [1, "b"]] as const) {
      await pool.query(
        `INSERT INTO execution_steps (execution_id, step_index, node_id, node_type, status, started_at, ended_at)
         VALUES ($1, $2, $3, 'condition', 'success', $4, $4)`,
        [execId, index, node, ts]
      );
    }
    const r = await call("GET", `/executions/${execId}`, { token: A.token });
    expect(r.status).toBe(200);
    expect(r.json.steps.map((s: { node_id: string }) => s.node_id)).toEqual(["a", "b", "c"]);
  });

  it("filters by status and validates its query", async () => {
    const wf = await createWorkflow(A.token, "filters");
    const run = await execute(A.token, wf);
    const execId = run.json.executionId as string;
    await pool.query("UPDATE executions SET status = 'failure', error = 'boom' WHERE id = $1", [execId]);

    const failed = await call("GET", `/executions?workflowId=${wf}&status=failure`, { token: A.token });
    expect(failed.json.items.map((i: { id: string }) => i.id)).toContain(execId);
    const succeeded = await call("GET", `/executions?workflowId=${wf}&status=success`, { token: A.token });
    expect(succeeded.json.items).toEqual([]);
    const limited = await call("GET", `/executions?workflowId=${wf}&limit=1`, { token: A.token });
    expect(limited.json.items).toHaveLength(1);
    expect((await call("GET", "/executions?status=banana", { token: A.token })).status).toBe(400);
    expect((await call("GET", "/executions?limit=1000", { token: A.token })).status).toBe(400);
  });

  it("answers 404 for a malformed or unknown execution ID", async () => {
    expect((await call("GET", "/executions/not-a-uuid", { token: A.token })).status).toBe(404);
    expect(
      (await call("GET", "/executions/00000000-0000-0000-0000-000000000000", { token: A.token })).status
    ).toBe(404);
  });
});