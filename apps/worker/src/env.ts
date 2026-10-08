  import { z } from "zod";

  const envSchema = z.object({
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
  });

  export const env = envSchema.parse(process.env);