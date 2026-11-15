import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { runWorkflow } from "./index";
import type { WorkflowDefinition, WorkflowNode } from "../dsl/schema";

let server: http.Server;
let baseUrl = "";
const hits: Record<string, number> = {};
const bodies: Record<string, unknown[]> = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "";
    hits[path] = (hits[path] ?? 0) + 1;
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        (bodies[path] ??= []).push(JSON.parse(raw));
      } catch {
        // ignore bodies that are not JSON
      }
      res.setHeader("Content-Type", "application/json");
      if (path === "/fail") {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "boom" }));
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  for (const key of Object.keys(hits)) delete hits[key];
  for (const key of Object.keys(bodies)) delete bodies[key];
});

const action = (id: string, path: string, maxAttempts = 1): WorkflowNode => ({
  id,
  type: "action",
  config: {
    kind: "http_request",
    url: `${baseUrl}${path}`,
    method: "POST",
    retry: { maxAttempts, backoffMs: 100 },
    timeoutMs: 5000,
  },
});

const branching = (): WorkflowDefinition => ({
  nodes: [
    { id: "trigger-1", type: "trigger", config: { kind: "webhook" } },
    { id: "cond-1", type: "condition", config: { field: "amount", operator: "greater_than", value: 100 } },
    action("action-true", "/true"),
    action("action-false", "/false"),
  ],
  edges: [
    { source: "trigger-1", target: "cond-1" },
    { source: "cond-1", target: "action-true", branch: "true" },
    { source: "cond-1", target: "action-false", branch: "false" },
  ],
});

const opts = { allowPrivateNetworks: true };

describe("runWorkflow", () => {
  it("takes the true branch and forwards the trigger payload", async () => {
    const result = await runWorkflow(branching(), { amount: 150 }, opts);

    expect(result.status).toBe("success");
    expect(result.steps.map((s) => s.nodeId)).toEqual(["trigger-1", "cond-1", "action-true"]);
    expect(hits["/true"]).toBe(1);
    expect(hits["/false"]).toBeUndefined();
    expect(bodies["/true"][0]).toEqual({ amount: 150 });
  });

  it("takes the false branch when the condition is not met", async () => {
    const result = await runWorkflow(branching(), { amount: 50 }, opts);

    expect(result.status).toBe("success");
    expect(result.steps.map((s) => s.nodeId)).toEqual(["trigger-1", "cond-1", "action-false"]);
    expect(hits["/false"]).toBe(1);
    expect(hits["/true"]).toBeUndefined();
  });

  it("retries a failing action the configured number of times, then reports failure", async () => {
    const def: WorkflowDefinition = {
      nodes: [{ id: "trigger-1", type: "trigger", config: { kind: "webhook" } }, action("action-1", "/fail", 3)],
      edges: [{ source: "trigger-1", target: "action-1" }],
    };

    const result = await runWorkflow(def, {}, opts);
    const step = result.steps.find((s) => s.nodeId === "action-1")!;

    expect(result.status).toBe("failure");
    expect(step.status).toBe("failure");
    expect(step.error).toBe("HTTP 500");
    expect((step.output as { attempts: number }).attempts).toBe(3);
    expect(hits["/fail"]).toBe(3);
  });
});