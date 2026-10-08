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
>;

const JOB_TIMEOUT_MESSAGE = "Execution timed out";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

async function attemptOnce(
  config: HttpRequestConfig,
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ActionExecutionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const onJobAbort = () => controller.abort();
  signal?.addEventListener("abort", onJobAbort, { once: true });

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
    const message = signal?.aborted
      ? JOB_TIMEOUT_MESSAGE
      : err.name === "AbortError"
        ? `Timed out after ${config.timeoutMs}ms`
        : err.message;
    return { success: false, attempts: 1, error: message };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onJobAbort);
  }
}

export async function executeHttpRequest(
  config: HttpRequestConfig,
  payload: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ActionExecutionResult> {
  let lastResult: ActionExecutionResult = { success: false, attempts: 0, error: "Not attempted" };

  for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt++) {
    if (signal?.aborted) {
      return { success: false, attempts: attempt - 1, error: JOB_TIMEOUT_MESSAGE };
    }

    lastResult = await attemptOnce(config, payload, signal);
    lastResult.attempts = attempt;

    if (lastResult.success || signal?.aborted) return lastResult;

    if (attempt < config.retry.maxAttempts) {
      await sleep(config.retry.backoffMs * attempt, signal);
    }
  }

  return lastResult;
}