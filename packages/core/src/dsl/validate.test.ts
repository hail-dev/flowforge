import { describe, it, expect } from "vitest";
import { validateWorkflowDefinition } from "./validate";

const trigger = { id: "trigger-1", type: "trigger", config: { kind: "webhook" } };
const condition = (id: string) => ({
  id,
  type: "condition",
  config: { field: "amount", operator: "greater_than", value: 100 },
});
const action = (id: string, config: Record<string, unknown> = {}) => ({
  id,
  type: "action",
  config: { kind: "http_request", url: "https://example.com/hook", method: "POST", ...config },
});
const edge = (source: string, target: string, branch?: "true" | "false") =>
  branch ? { source, target, branch } : { source, target };
const check = (nodes: unknown[], edges: unknown[]) => validateWorkflowDefinition({ nodes, edges });

describe("validateWorkflowDefinition", () => {
  it("accepts trigger -> action", () => {
    expect(check([trigger, action("a1")], [edge("trigger-1", "a1")])).toEqual({ valid: true, errors: [] });
  });

  it("accepts a branching workflow", () => {
    const r = check(
      [trigger, condition("c1"), action("a1"), action("a2")],
      [edge("trigger-1", "c1"), edge("c1", "a1", "true"), edge("c1", "a2", "false")]
    );
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("rejects a definition with no nodes or edges fields", () => {
    const r = validateWorkflowDefinition({});
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("nodes");
  });

  it("rejects an empty node list", () => {
    expect(check([], []).valid).toBe(false);
  });

  it("rejects two triggers", () => {
    const r = check([trigger, { ...trigger, id: "trigger-2" }], []);
    expect(r.errors).toContain("Workflow must have exactly one trigger node (found 2)");
  });

  it("rejects a workflow with no trigger", () => {
    const r = check([action("a1")], []);
    expect(r.errors).toContain("Workflow must have exactly one trigger node (found 0)");
  });

  it("rejects duplicate node IDs", () => {
    const r = check([trigger, action("trigger-1")], []);
    expect(r.errors).toContain("Node IDs must be unique");
  });

  it("rejects an edge to an unknown node", () => {
    const r = check([trigger, action("a1")], [edge("trigger-1", "ghost")]);
    expect(r.errors).toContain("Edge references unknown target node: ghost");
  });

  it("rejects an incoming edge to the trigger", () => {
    const r = check([trigger, action("a1")], [edge("trigger-1", "a1"), edge("a1", "trigger-1")]);
    expect(r.errors).toContain("Trigger node cannot have incoming edges");
  });

  it("rejects a condition with only one branch", () => {
    const r = check(
      [trigger, condition("c1"), action("a1")],
      [edge("trigger-1", "c1"), edge("c1", "a1", "true")]
    );
    expect(r.errors).toContain('Condition node "c1" must have exactly one "true" and one "false" outgoing edge');
  });

  it("rejects a condition with two edges on the same branch", () => {
    const r = check(
      [trigger, condition("c1"), action("a1"), action("a2")],
      [edge("trigger-1", "c1"), edge("c1", "a1", "true"), edge("c1", "a2", "true")]
    );
    expect(r.errors).toContain('Condition node "c1" must have exactly one "true" and one "false" outgoing edge');
  });

  it("rejects an action with two outgoing edges", () => {
    const r = check(
      [trigger, action("a"), action("b"), action("c")],
      [edge("trigger-1", "a"), edge("a", "b"), edge("a", "c")]
    );
    expect(r.errors).toContain('Action node "a" can have at most one outgoing edge');
  });

  it("rejects a branch label on an action edge", () => {
    const r = check([trigger, action("a"), action("b")], [edge("trigger-1", "a"), edge("a", "b", "true")]);
    expect(r.errors).toContain('Action node "a" edges must not specify a branch');
  });

  it("rejects a node that is unreachable from the trigger", () => {
    const r = check([trigger, action("a1"), action("a2")], [edge("trigger-1", "a1")]);
    expect(r.errors).toContain('Node "a2" is unreachable from the trigger');
  });

  it("rejects a cycle", () => {
    const r = check(
      [trigger, condition("c1"), condition("c2"), action("a")],
      [
        edge("trigger-1", "c1"),
        edge("c1", "c2", "true"),
        edge("c1", "a", "false"),
        edge("c2", "c1", "true"),
        edge("c2", "a", "false"),
      ]
    );
    expect(r).toEqual({ valid: false, errors: ["Workflow graph must not contain cycles"] });
  });

  it("accepts a valid cron trigger", () => {
    const cron = { id: "t", type: "trigger", config: { kind: "cron", expression: "*/5 * * * *" } };
    expect(check([cron], [])).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ["banana", "Cron expression must have exactly 5 fields (minute hour day-of-month month weekday)"],
    ["* * * * * *", "Cron expression must have exactly 5 fields (minute hour day-of-month month weekday)"],
    ["99 * * * *", "Invalid cron expression: 99 * * * *"],
  ])("rejects the cron expression %s", (expression, message) => {
    const cron = { id: "t", type: "trigger", config: { kind: "cron", expression } };
    expect(check([cron], []).errors).toContain(message);
  });

  it("rejects a non-http action URL", () => {
    const r = check([trigger, action("a1", { url: "file:///etc/passwd" })], [edge("trigger-1", "a1")]);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("URL must use http:// or https://");
  });

  it.each([0, 6])("rejects retry.maxAttempts = %i", (maxAttempts) => {
    const r = check(
      [trigger, action("a1", { retry: { maxAttempts, backoffMs: 1000 } })],
      [edge("trigger-1", "a1")]
    );
    expect(r.valid).toBe(false);
  });
});