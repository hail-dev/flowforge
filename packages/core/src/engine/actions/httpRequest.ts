import { fetch } from "undici";
import { WorkflowNode } from "../../dsl/schema";
import { assertSafeUrl, guardedAgent, BLOCKED_CODE } from "./urlGuard";

export interface ActionExecutionResult {
  success: boolean;
  attempts: number;
  statusCode?: number;
  responseBody?: unknown;
  error?: string;
  permanent?: boolean; // retrying cannot help, for example a blocked destination
}

export interface HttpRequestOptions {
  signal?: AbortSignal;
  allowPrivateNetworks?: boolean;
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

function isBlocked(err: any): boolean {
  return err?.code === BLOCKED_CODE || err?.cause?.code === BLOCKED_CODE;
}

export function describeFetchError(err: any): string {
  const cause = err?.cause;
  if (err?.code === BLOCKED_CODE) return err.message;
  if (cause?.code === BLOCKED_CODE) return cause.message;
  const code = cause?.code ?? cause?.errno;
  if (code) return `${err.message} (${code})`;
  if (cause?.message) return `${err.message} (${cause.message})`;
  return err.message;
}

async function attemptOnce(
  config: HttpRequestConfig,
  payload: Record<string, unknown>,
  options: HttpRequestOptions
): Promise<ActionExecutionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const onJobAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onJobAbort, { once: true });

  try {
    if (!options.allowPrivateNetworks) assertSafeUrl(config.url);

    const response = await fetch(config.url, {
      method: config.method,
      headers: { "Content-Type": "application/json", ...config.headers },
      body: config.method === "GET" ? undefined : JSON.stringify(config.body ?? payload),
      signal: controller.signal,
      redirect: "manual", // never follow redirects: a public URL could bounce us to a private one
      ...(options.allowPrivateNetworks ? {} : { dispatcher: guardedAgent }),
    });

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = undefined;
    }

    const redirected = response.status >= 300 && response.status < 400;
    return {
      success: response.ok,
      attempts: 1,
      statusCode: response.status,
      responseBody,
      error: response.ok
        ? undefined
        : redirected
          ? `HTTP ${response.status} (redirects are not followed)`
          : `HTTP ${response.status}`,
    };
  } catch (err: any) {
    const message = options.signal?.aborted
      ? JOB_TIMEOUT_MESSAGE
      : err.name === "AbortError"
        ? `Timed out after ${config.timeoutMs}ms`
        : describeFetchError(err);
    return { success: false, attempts: 1, error: message, permanent: isBlocked(err) };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onJobAbort);
  }
}

export async function executeHttpRequest(
  config: HttpRequestConfig,
  payload: Record<string, unknown>,
  options: HttpRequestOptions = {}
): Promise<ActionExecutionResult> {
  let lastResult: ActionExecutionResult = { success: false, attempts: 0, error: "Not attempted" };

  for (let attempt = 1; attempt <= config.retry.maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      return { success: false, attempts: attempt - 1, error: JOB_TIMEOUT_MESSAGE };
    }

    lastResult = await attemptOnce(config, payload, options);
    lastResult.attempts = attempt;

    if (lastResult.success || options.signal?.aborted || lastResult.permanent) return lastResult;

    if (attempt < config.retry.maxAttempts) {
      await sleep(config.retry.backoffMs * attempt, options.signal);
    }
  }

  return lastResult;
}