import { defineConfig } from "vitest/config";

// load the repo .env
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