import { time } from "node:console";
import { WorkflowNode } from "../../dsl/schema";

export interface ActionExecutionResult {
    success: boolean;
    attempts: number;
    statusCode?: number;
    responseBody?: unknown;
    error?: string;
}

type HttpRequestConfig = Extract<
    Extract<WorkflowNode, { type: "action" }>["config"],
    { kind: "http_request" }
> & {
    timeoutMs?: number;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptOnce(
    config: HttpRequestConfig,
    payload: Record<string, unknown>
): Promise<ActionExecutionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
        const response = await fetch(config.url, {
            method: config.method,
            headers: { "Content-Type": "application/json", ...config.headers },
            body: config.method === "GET" ? undefined : JSON.stringify(config.body ?? payload),
            signal: controller.signal,
        });

        let responseBody: unknown;
        try {
            responseBody = await response.json();
        } catch {
            responseBody = undefined;
        }

        return {
            success: response.ok,
            attempts: 1,
            statusCode: response.status,
            responseBody,
            error: response.ok ? undefined : `HTTP ${response.status}`,
        };
    } catch (err: any) {
        const message = err.name === "AbortError" ? `Timed out after ${config.timeoutMs}` : err.message;
        return { success: false, attempts: 1, error: message };
    } finally {
        clearTimeout(timeout);
    }
}

export async function executeHttpRequest(
    config: HttpRequestConfig,
    payload: Record<string, unknown>
): Promise<ActionExecutionResult> {
    let lastResult: ActionExecutionResult = { success: false, attempts: 0, error: "Not attempted" };

    for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt++) {
        lastResult = await attemptOnce(config, payload);
        lastResult.attempts = attempt;

        if (lastResult.success) return lastResult;

        if (attempt < config.retry.maxAttempts) {
            await sleep(config.retry.backoffMs * attempt); //linear backoff
        }
    }

    return lastResult;
}