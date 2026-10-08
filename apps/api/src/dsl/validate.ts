import { workflowDefinitionSchema, WorkflowDefinition } from "./schema";

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export function validateWorkflowDefinition(input: unknown): ValidationResult {
    const parsed = workflowDefinitionSchema.safeParse(input);
    if (!parsed.success) {
        return {
            valid: false,
            errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        };
    }

    return validateGraphStructure(parsed.data);
}

export function validateGraphStructure(def: WorkflowDefinition): ValidationResult {
    const errors: string[] = [];
    const nodeIds = new Set(def.nodes.map((n) => n.id));

    // unique node IDs
    if (nodeIds.size !== def.nodes.length) {
        errors.push("Node IDs must be unique");
    }

    // exactly one trigger
    const triggers = def.nodes.filter((n) => n.type === "trigger");
    if (triggers.length !== 1) {
        errors.push(`Workflow must have exactly one trigger node (found ${triggers.length})`);
    }

    // edges reference real nodes
    for (const edge of def.edges) {
      if (!nodeIds.has(edge.source)) errors.push(`Edge references unknown source node: ${edge.source}`);
      if (!nodeIds.has(edge.target)) errors.push(`Edge references unknown target node: ${edge.target}`);
    }

    // trigger has no incoming edges
    if (triggers.length === 1) {
        const triggerId = triggers[0].id;
        const hasIncoming = def.edges.some((e) => e.target === triggerId);
        if (hasIncoming) errors.push("Trigger node cannot have incoming edges");
    }

    // condition nodes: exactly one "true" and one "false" outgoing edge
    for (const node of def.nodes) {
        if (node.type === "condition") {
            const outgoing = def.edges.filter((e) => e.source === node.id);
            const branches = outgoing.map((e) => e.branch);
            if (!branches.includes("true") || !branches.includes("false") || outgoing.length !== 2) {
                errors.push(`Condition node "${node.id}" must have exactly one "true" and one "false" outgoing edge`);
            }
        }
    }

    // action nodes: at most one outgoing edge, and must not use "branch"
    for (const node of def.nodes) {
        if (node.type === "action") {
            const outgoing = def.edges.filter((e) => e.source === node.id);
            if (outgoing.length > 1) {
                errors.push(`Action node "${node.id}" can have at most one outgoing edge`);
            }
            if (outgoing.some((e) => e.branch)) {
                errors.push(`Action node "${node.id}" edges must not specify a branch`);
            }
        }
    }

    // reachability: every node reachable from the trigger
    if (triggers.length === 1 && errors.length === 0) {
        const reachable = new Set<string>([triggers[0].id]);
        const queue = [triggers[0].id];
        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const edge of def.edges.filter((e) => e.source === current)) {
                if (!reachable.has(edge.target)) {
                    reachable.add(edge.target);
                    queue.push(edge.target);
                }
            }
        }
        for (const node of def.nodes) {
            if (!reachable.has(node.id)) {
                errors.push(`Node "${node.id}" is unreachable from the trigger`);
            }
        }
    }

    // cycle detection (DFS): state 1 = in current path, 2 = fully explored
    if (errors.length === 0) {
        const adjacency = new Map<string, string[]>();
        for (const e of def.edges) {
            adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
        }
        const state = new Map<string, 1 | 2>();
        const hasCycle = (id: string): boolean => {
            state.set(id, 1);
            for (const next of adjacency.get(id) ?? []) {
                const s = state.get(next);
                if (s === 1) return true;
                if (s === undefined && hasCycle(next)) return true;
            }
            state.set(id, 2);
            return false;
        };
        if (def.nodes.some((n) => state.get(n.id) === undefined && hasCycle(n.id))) {
            errors.push("Workflow graph must not contain cycles");
        }
    }

    return { valid: errors.length === 0, errors};
}