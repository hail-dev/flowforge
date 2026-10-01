import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { hashPassword, verifyPassword } from "./password";
import { signToken } from "./jwt";

export const authRouter = Router();

const registerSchema = z.object({
    tenantName: z.string().min(1).max(200),
    email: z.email(),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

authRouter.post("/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { tenantName, email, password } = parsed.data;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const tenantResult = await client.query<{ id: string}>(
            "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
            [tenantName]
        );
        const tenantId = tenantResult.rows[0].id;

        const passwordHash = await hashPassword(password);

        const userResult = await client.query<{ id: string }>(
            `INSERT INTO users (tenant_id, email, password_hash)
            VALUES ($1, $2, $3) RETURNING id`,
            [tenantId, email, passwordHash]
        );
        const userId = userResult.rows[0].id;

        await client.query("COMMIT");

        const token = signToken({ userId, tenantId });
        res.status(201).json({ token });
    } catch (err: any) {
        await client.query("ROLLBACK");
        if (err.code === "23505") {
            // unique_violation on users.email
            return res.status(409).json({ error: "Email already registered" });
        }
        console.error("register error:", err);
        res.status(500).json({ error: "Internal server error"});
    } finally {
        client.release();
    }
});

const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const result = await pool.query<{
        id: string;
        tenant_id: string;
        password_hash: string;
    }>("SELECT id, tenant_id, password_hash FROM users WHERE email = $1", [email]);

    const user = result.rows[0];
    // deliberately generic error for error both "no user" and "wrong password"
    // to avoid leaking which emails are registered.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
        return res.status(401).json({ error: "Invalid email or password" });
    }
    
    const token =  signToken({ userId: user.id, tenantId: user.tenant_id });
    res.json({ token })
});