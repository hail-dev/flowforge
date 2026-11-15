import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Load the repo .env (if present) so the test database can be derived from DATABASE_URL.
try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env (for example in CI): fall back to the defaults below
}

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base =
    process.env.DATABASE_URL ?? "postgresql://flowforge:flowforge_dev_password@localhost:5432/flowforge";
  const url = new URL(base);
  url.pathname = "/flowforge_test";
  return url.toString();
}

export default defineConfig({
  resolve: {
    // Tests run against core's source, so they never see a stale dist.
    alias: [
      {
        find: /^@flowforge\/core$/,
        replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    env: {
      DATABASE_URL: testDatabaseUrl(),
      REDIS_URL: "redis://localhost:6379/15",
      JWT_SECRET: "test-only-secret-0123456789abcdef",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    },
  },
});