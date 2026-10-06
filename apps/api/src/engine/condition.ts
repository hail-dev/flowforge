import { WorkflowNode } from "../dsl/schema";

function getByPath(obj: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, key) => {
        if (acc && typeof acc === "object" && key in (acc as object)) {
            return (acc as Record<string, unknown>)[key];
        }
        return undefined;
    }, obj);
}

export function evaluateCondition(
    config: Extract<WorkflowNode, { type: "condition" }>["config"],
    payload: Record<string, unknown>
): boolean {
    const actual = getByPath(payload, config.field);

    switch (config.operator) {
        case "equals":
            return actual === config.value;
        case "not_equals":
            return actual !== config.value;
        case "greater_than":
            return typeof actual === "number" && typeof config.value === "number" && actual > config.value;
        case "less_than":
            return typeof actual === "number" && typeof config.value === "number" && actual < config.value;
        case "contains":
            return typeof actual === "string" && typeof config.value === "string" && actual.includes(config.value);
        default:
            return false;
    }
}
