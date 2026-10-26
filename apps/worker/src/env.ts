import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
    // Not z.coerce.boolean(): it turns the string "false" into true.
    ALLOW_PRIVATE_NETWORKS: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(25000),
    SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(60000),
    PENDING_SWEEP_AFTER_MS: z.coerce.number().int().min(1000).default(120000),
  })
  .refine((e) => !(e.NODE_ENV === "production" && e.ALLOW_PRIVATE_NETWORKS), {
    message: "ALLOW_PRIVATE_NETWORKS must be false when NODE_ENV=production",
  });

export const env = envSchema.parse(process.env);