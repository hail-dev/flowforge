import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { rateLimit, type RateLimitStore } from "./rateLimit";

function memoryStore() {
  const counts = new Map<string, number>();
  const seenKeys: string[] = [];
  const store: RateLimitStore = {
    async hit(key) {
      seenKeys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { count, ttlMs: 60_000 };
    },
  };
  return { store, seenKeys };
}

async function call(mw: ReturnType<typeof rateLimit>, ip: string) {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;
  let nextCalled = false;
  const req = { ip, params: {} } as unknown as Request;
  const res: any = {
    setHeader: (k: string, v: string) => {
      headers[k] = String(v);
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(b: unknown) {
      body = b;
      return res;
    },
  };
  await mw(req, res, () => {
    nextCalled = true;
  });
  return { headers, statusCode, body, nextCalled };
}

const byIp = (req: Request) => (req as any).ip as string;

describe("rateLimit", () => {
  it("allows requests up to the limit, then answers 429", async () => {
    const { store } = memoryStore();
    const mw = rateLimit({ name: "t", limit: 3, windowMs: 60_000, key: byIp, store });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await call(mw, "1.2.3.4"));
    expect(results.map((r) => r.nextCalled)).toEqual([true, true, true, false]);
    expect(results[3].statusCode).toBe(429);
    expect(results[3].body).toEqual({ error: "Too many requests. Please try again later." });
  });

  it("reports Retry-After in whole seconds, rounded up", async () => {
    const store: RateLimitStore = { hit: async () => ({ count: 99, ttlMs: 2500 }) };
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 60_000, key: byIp, store });
    const r = await call(mw, "1.2.3.4");
    expect(r.statusCode).toBe(429);
    expect(r.headers["Retry-After"]).toBe("3");
  });

  it("counts different keys independently", async () => {
    const { store } = memoryStore();
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 60_000, key: byIp, store });
    expect((await call(mw, "1.1.1.1")).nextCalled).toBe(true);
    expect((await call(mw, "2.2.2.2")).nextCalled).toBe(true);
    expect((await call(mw, "1.1.1.1")).statusCode).toBe(429);
  });

  it("skips limiting when the key function returns null", async () => {
    const { store, seenKeys } = memoryStore();
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 60_000, key: () => null, store });
    const r = await call(mw, "1.2.3.4");
    expect(r.nextCalled).toBe(true);
    expect(seenKeys).toHaveLength(0);
  });

  it("never hands the raw key to the store", async () => {
    const { store, seenKeys } = memoryStore();
    const mw = rateLimit({ name: "hook", limit: 5, windowMs: 60_000, key: () => "super-secret-value", store });
    await call(mw, "1.2.3.4");
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toMatch(/^rl:hook:[0-9a-f]{32}$/);
    expect(seenKeys[0]).not.toContain("super-secret-value");
  });

  it("fails open when the store throws", async () => {
    const store: RateLimitStore = {
      hit: async () => {
        throw new Error("redis is down");
      },
    };
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 60_000, key: byIp, store });
    const r = await call(mw, "1.2.3.4");
    expect(r.nextCalled).toBe(true);
    expect(r.statusCode).toBe(200);
  });

  it("fails open when the store hangs", async () => {
    const store: RateLimitStore = { hit: () => new Promise(() => {}) };
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 60_000, key: byIp, store, timeoutMs: 20 });
    const r = await call(mw, "1.2.3.4");
    expect(r.nextCalled).toBe(true);
  });

  it("reports a shrinking X-RateLimit-Remaining", async () => {
    const { store } = memoryStore();
    const mw = rateLimit({ name: "t", limit: 3, windowMs: 60_000, key: byIp, store });
    const first = await call(mw, "1.2.3.4");
    const second = await call(mw, "1.2.3.4");
    expect(first.headers["X-RateLimit-Limit"]).toBe("3");
    expect(first.headers["X-RateLimit-Remaining"]).toBe("2");
    expect(second.headers["X-RateLimit-Remaining"]).toBe("1");
  });
});