import { describe, it, expect } from "vitest";
import { evaluateCondition } from "./condition";
import type { WorkflowNode } from "../dsl/schema";

type Config = Extract<WorkflowNode, { type: "condition" }>["config"];
const cfg = (operator: Config["operator"], value: Config["value"], field = "amount"): Config => ({
  field,
  operator,
  value,
});

describe("evaluateCondition", () => {
  it("equals matches the same value", () => {
    expect(evaluateCondition(cfg("equals", 100), { amount: 100 })).toBe(true);
  });

  it("equals rejects a different value", () => {
    expect(evaluateCondition(cfg("equals", 100), { amount: 101 })).toBe(false);
  });

  it("equals works for strings and booleans", () => {
    expect(evaluateCondition(cfg("equals", "pro", "plan"), { plan: "pro" })).toBe(true);
    expect(evaluateCondition(cfg("equals", true, "paid"), { paid: true })).toBe(true);
    expect(evaluateCondition(cfg("equals", true, "paid"), { paid: "true" })).toBe(false);
  });

  it("not_equals is true for a different value", () => {
    expect(evaluateCondition(cfg("not_equals", 100), { amount: 5 })).toBe(true);
  });

  it("not_equals is true when the field is missing (documented behaviour)", () => {
    expect(evaluateCondition(cfg("not_equals", 100), {})).toBe(true);
  });

  it("greater_than compares numbers", () => {
    expect(evaluateCondition(cfg("greater_than", 100), { amount: 150 })).toBe(true);
  });

  it("greater_than is false when the values are equal", () => {
    expect(evaluateCondition(cfg("greater_than", 100), { amount: 100 })).toBe(false);
  });

  it("greater_than does not coerce strings", () => {
    expect(evaluateCondition(cfg("greater_than", 5), { amount: "10" })).toBe(false);
    expect(evaluateCondition(cfg("greater_than", "5"), { amount: 10 })).toBe(false);
  });

  it("greater_than is false when the field is missing", () => {
    expect(evaluateCondition(cfg("greater_than", 5), {})).toBe(false);
  });

  it("less_than compares numbers", () => {
    expect(evaluateCondition(cfg("less_than", 100), { amount: 50 })).toBe(true);
    expect(evaluateCondition(cfg("less_than", 100), { amount: 100 })).toBe(false);
  });

  it("less_than does not coerce strings", () => {
    expect(evaluateCondition(cfg("less_than", 100), { amount: "50" })).toBe(false);
  });

  it("contains finds a substring", () => {
    expect(evaluateCondition(cfg("contains", "world", "text"), { text: "hello world" })).toBe(true);
    expect(evaluateCondition(cfg("contains", "xyz", "text"), { text: "hello world" })).toBe(false);
  });

  it("contains is false when the payload value is not a string", () => {
    expect(evaluateCondition(cfg("contains", "1", "text"), { text: 123 })).toBe(false);
  });

  it("contains is false when the configured value is not a string", () => {
    expect(evaluateCondition(cfg("contains", 1, "text"), { text: "123" })).toBe(false);
  });

  it("reads nested fields with a dot path", () => {
    expect(evaluateCondition(cfg("equals", "pro", "customer.plan"), { customer: { plan: "pro" } })).toBe(true);
  });

  it("is false for a missing nested field", () => {
    expect(evaluateCondition(cfg("equals", "pro", "customer.plan"), { customer: {} })).toBe(false);
  });

  it("does not crash when the path runs through a non-object", () => {
    expect(evaluateCondition(cfg("equals", "pro", "customer.plan"), { customer: "x" })).toBe(false);
  });
});