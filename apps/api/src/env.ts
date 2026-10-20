import { z } from "zod";

const envSchema = z.object({
    API_PORT: z.coerce.number().default(3001),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);