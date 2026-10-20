import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { apiLog } from "./logger";

export interface HitResult {
  count: number;
  ttlMs: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<HitResult>;
}

export interface LimiterOptions {
  name: string;
  limit: number;
  windowMs: number;
  // Return null to skip limiting for this request.
  key: (req: Request) => string | null;
  store: RateLimitStore;
  timeoutMs?: number;
}

export function rateLimit(opts: LimiterOptions) {
  const timeoutMs = opts.timeoutMs ?? 500;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = opts.key(req);
    if (rawKey === null) {
      next();
      return;
    }

    // Hash the key so secrets (like webhook URLs) never sit in Redis in plaintext.
    const storeKey = `rl:${opts.name}:${createHash("sha256").update(rawKey).digest("hex").slice(0, 32)}`;

    let result: HitResult;
    let timer: NodeJS.Timeout | undefined;
    try {
      result = await Promise.race([
        opts.store.hit(storeKey, opts.windowMs),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("rate limit store timeout")), timeoutMs);
        }),
      ]);
    } catch (err) {
      apiLog.warn({ err, limiter: opts.name }, "rate limit store unavailable, allowing request");
      next();
      return;
    } finally {
      if (timer) clearTimeout(timer);
    }

    res.setHeader("X-RateLimit-Limit", String(opts.limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, opts.limit - result.count)));

    if (result.count > opts.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.ttlMs / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      apiLog.warn({ limiter: opts.name }, "rate limit exceeded");
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }

    next();
  };
}