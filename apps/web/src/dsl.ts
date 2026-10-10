import type { Node, Edge } from "@xyflow/react";
import type { WorkflowDefinition, WorkflowNode } from "../../api/src/dsl/schema";

export type FlowNodeData = { dsl: WorkflowNode };
export type FlowNode = Node<FlowNodeData, "ff">;

export function toFlow(def: WorkflowDefinition): { nodes: FlowNode[]; edges: Edge[] } {
  const nodes: FlowNode[] = def.nodes.map((n, i) => ({
    id: n.id,
    type: "ff",
    position: n.position ?? { x: i * 260, y: 100 },
    deletable: n.type !== "trigger",
    data: { dsl: n },
  }));
  const edges: Edge[] = def.edges.map((e, i) => ({
    id: `e${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.branch ?? null,
  }));
  return { nodes, edges };
}

export function toDefinition(nodes: FlowNode[], edges: Edge[]): WorkflowDefinition {
    return {
        nodes: nodes.map((n) => ({
            ...n.data.dsl,
            position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        })),
        edges: edges.map((e) => {
            const branch = e.sourceHandle === "true" || e.sourceHandle === "false" ? e.sourceHandle : undefined;
            return branch
                ? { source: e.source, target: e.target, branch }
                : { source: e.source, target: e.target };
        }),
    };
}

export function nextId(prefix: string, existing: FlowNode[]): string {
  let i = 1;
  while (existing.some((n) => n.id === `${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}

export function defaultNode(type: WorkflowNode["type"], id: string): WorkflowNode {
  switch (type) {
    case "trigger":
      return { id, type, config: { kind: "webhook" } };
    case "condition":
      return { id, type, config: { field: "amount", operator: "greater_than", value: 100 } };
    case "action":
      return {
        id,
        type,
        config: {
          kind: "http_request",
          url: "https://httpbin.org/post",
          method: "POST",
          retry: { maxAttempts: 1, backoffMs: 1000 },
          timeoutMs: 10000,
        },
      };
  }
}