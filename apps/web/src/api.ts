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
