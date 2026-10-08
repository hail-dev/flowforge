import { WorkflowDefinition, WorkflowNode } from "../dsl/schema";
import { evaluateCondition } from "./condition";
import { executeHttpRequest } from "./actions/httpRequest";
import { response } from "express";

export interface StepResult {
    nodeId: string;
    type: WorkflowNode["type"];
    status: "success" | "failure" | "skipped";
    startedAt: string;
    endedAt: string;
    output?: unknown;
    error?: string;
}

export interface ExecutionResult {
    status: "success" | "failure";
    steps: StepResult[];
}

function findNode(def: WorkflowDefinition, id: string): WorkflowNode {
    const node = def.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`Enginer error: node ${id} not found (should have been caught by validation)`);
    return node;
}

function nextNodeId(def: WorkflowDefinition, fromId: string, branch?: "true" | "false"): string | undefined {
    const edge = def.edges.find((e) => e.source === fromId && (branch === undefined || e.branch === branch));
    return edge?.target;
}

export async function runWorkflow(
    def: WorkflowDefinition,
    triggerPayload: Record<string, unknown>,
    options: { signal?: AbortSignal } = {}
): Promise<ExecutionResult> {
    const trigger = def.nodes.find((n) => n.type === "trigger");
    if (!trigger) throw new Error("Engine error: no trigger node (should have been caught by validation)");

    const steps: StepResult[] = [];
    let currentId: string | undefined = nextNodeId(def, trigger.id);
    let failed = false;

    // record the trigger itself as a step for a complete audit retail
    const triggerStart = new Date().toISOString();
    steps.push({
        nodeId: trigger.id,
        type: "trigger",
        status: "success",
        startedAt: triggerStart,
        endedAt: triggerStart,
        output: triggerPayload
    });

    while (currentId && !failed) {
        const node = findNode(def, currentId);
        const startedAt = new Date().toISOString();

        if (options.signal?.aborted) {
            steps.push({
                nodeId: node.id,
                type: node.type,
                status: "failure",
                startedAt,
                endedAt: new Date().toISOString(),
                error: "Execution timed out",
            });
            failed = true;
            break;
        }

        if (node.type === "condition") {
            const result = evaluateCondition(node.config, triggerPayload);
            steps.push({
                nodeId: node.id,
                type: "condition",
                status: "success",
                startedAt,
                endedAt: new Date().toISOString(),
                output: { result },
            });
            currentId = nextNodeId(def, node.id, result ? "true" : "false");
            continue
        }

        if (node.type === "action") {
            if (node.config.kind === "http_request") {
                const result = await executeHttpRequest(node.config, triggerPayload, options.signal);
                steps.push({
                    nodeId: node.id,
                    type: "action",
                    status: result.success ? "success" : "failure",
                    startedAt,
                    endedAt: new Date().toISOString(),
                    output: { statuscode: result.statusCode, responseBody: result.responseBody, attempts: result.attempts },
                    error: result.error,
                });
                if (!result.success) {
                    failed = true;
                    break;
                }
            }
            currentId = nextNodeId(def, node.id);
            continue
        }

        // unreachable given valdiation, but keeps the loop well-defined
        currentId = undefined
    }

    return { status: failed ? "failure" : "success", steps };
}