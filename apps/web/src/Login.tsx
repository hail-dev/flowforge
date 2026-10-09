import { useState } from "react";
import { login } from "./api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        try {
            await login(email, password);
            onSuccess();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Login failed");
        }
    }

    return (
        <form onSubmit={handleSubmit} style={{ maxWidth: 320, margin: "20vh auto", display: "grid", gap: 12}}>
            <h2>FlowForge</h2>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit">Log in</button>
            {error && <p style={{ color: "crimson" }}>{error}</p>}
        </form>
    );
}