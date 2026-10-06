  import { describe, it, expect } from "vitest";
  import { runWorkflow } from "./index";
  import { WorkflowDefinition } from "../dsl/schema";

  describe("runWorkflow", () => {
    it("runs trigger -> condition(true) -> action and succeeds against httpbin", async () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: "trigger-1", type: "trigger", config: { kind: "webhook" } },
          {
            id: "cond-1",
            type: "condition",
            config: { field: "amount", operator: "greater_than", value: 100 },
          },
          {
            id: "action-true",
            type: "action",
            config: {
              kind: "http_request",
              url: "https://httpbin.org/post",
              method: "POST",
              retry: { maxAttempts: 1, backoffMs: 1000 },
              timeoutMs: 10_000,
            },
          },
          {
            id: "action-false",
            type: "action",
            config: {
              kind: "http_request",
              url: "https://httpbin.org/post",
              method: "POST",
              retry: { maxAttempts: 1, backoffMs: 1000 },
              timeoutMs: 10_000,
            },
          },
        ],
        edges: [
          { source: "trigger-1", target: "cond-1" },
          { source: "cond-1", target: "action-true", branch: "true" },
          { source: "cond-1", target: "action-false", branch: "false" },
        ],
      };

      const result = await runWorkflow(def, { amount: 150 });

      expect(result.status).toBe("success");
      expect(result.steps.map((s) => s.nodeId)).toEqual(["trigger-1", "cond-1", "action-true"]);
      expect(result.steps[2].status).toBe("success");
    }, 15_000);

    it("follows the false branch when the condition fails", async () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: "trigger-1", type: "trigger", config: { kind: "webhook" } },
          { id: "cond-1", type: "condition", config: { field: "amount", operator: "greater_than", value: 100 } },
          {
            id: "action-true",
            type: "action",
            config: { kind: "http_request", url: "https://httpbin.org/post", method: "POST", retry: { maxAttempts: 1, backoffMs: 1000 }, timeoutMs: 10_000 },
          },
          {
            id: "action-false",
            type: "action",
            config: { kind: "http_request", url: "https://httpbin.org/post", method: "POST", retry: { maxAttempts: 1, backoffMs: 1000 }, timeoutMs: 10_000 },
          },
        ],
        edges: [
          { source: "trigger-1", target: "cond-1" },
          { source: "cond-1", target: "action-true", branch: "true" },
          { source: "cond-1", target: "action-false", branch: "false" },
        ],
      };

      const result = await runWorkflow(def, { amount: 50 });

      expect(result.steps.map((s) => s.nodeId)).toEqual(["trigger-1", "cond-1", "action-false"]);
    }, 15_000);

    it("retries a failing action the configured number of times, then reports failure", async () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: "trigger-1", type: "trigger", config: { kind: "webhook" } },
          {
            id: "action-1",
            type: "action",
            config: {
              kind: "http_request",
              url: "https://httpbin.org/status/500",
              method: "POST",
              retry: { maxAttempts: 3, backoffMs: 100 },
              timeoutMs: 5_000,
            },
          },
        ],
        edges: [{ source: "trigger-1", target: "action-1" }],
      };

      const result = await runWorkflow(def, {});

      expect(result.status).toBe("failure");
      const actionStep = result.steps.find((s) => s.nodeId === "action-1")!;
      expect(actionStep.status).toBe("failure");
      expect((actionStep.output as any).attempts).toBe(3);
    }, 15_000);
  });