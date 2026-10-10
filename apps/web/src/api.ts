const TOKEN_KEY = "flowforge_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export async function login(email: string, password: string): Promise<void> {
    const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Login failed (${res.status})`);
    localStorage.setItem(TOKEN_KEY, body.token);
}

export class ApiError extends Error {
  status: number;
  details: string[];
  constructor(message: string, status: number, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new ApiError("Session expired", 401);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      typeof body.error === "string" ? body.error : `Request failed (${res.status})`,
      res.status,
      Array.isArray(body.details) ? body.details : []
    );
  }
  return body as T;
}

export type WorkflowSummary = { id: string; name: string; is_active: boolean};
export type WorkflowFull = WorkflowSummary & { definition: unknown};

export const listWorkflows = () => request<WorkflowSummary[]>("/workflows");
export const getWorkflow = (id: string) => request<WorkflowFull>(`/workflows/${id}`);
export const saveDefinition = (id:string, definition: unknown) =>
    request<WorkflowFull>(`/workflows/${id}`, { method: "PUT", body: JSON.stringify({ definition }) });
export const createWorkflow = (name: string, definition: unknown) =>
  request<WorkflowFull>("/workflows", { method: "POST", body: JSON.stringify({ name, definition }) });
