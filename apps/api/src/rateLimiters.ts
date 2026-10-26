import type { Request } from "express";
import { redis } from "./redis";
import { rateLimit, type RateLimitStore } from "./rateLimit";
import type { AuthedRequest } from "./auth/middleware";

// One atomic step: count the hit, start the window on the first hit, and report the time left.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export const redisStore: RateLimitStore = {
  async hit(key, windowMs) {
    const [count, ttlMs] = (await redis.eval(HIT_SCRIPT, 1, key, windowMs)) as [number, number];
    return { count, ttlMs };
  },
};

const clientIp = (req: Request) => req.ip ?? "unknown";

export const loginLimiter = rateLimit({
  name: "login",
  limit: 10,
  windowMs: 15 * 60_000,
  key: clientIp,
  store: redisStore,
});

export const registerLimiter = rateLimit({
  name: "register",
  limit: 5,
  windowMs: 60 * 60_000,
  key: clientIp,
  store: redisStore,
});

export const hookIpLimiter = rateLimit({
  name: "hook-ip",
  limit: 120,
  windowMs: 60_000,
  key: clientIp,
  store: redisStore,
});

export const hookSecretLimiter = rateLimit({
  name: "hook-secret",
  limit: 60,
  windowMs: 60_000,
  key: (req) => {
    const secret = req.params.secret;

    return typeof secret === "string" && /^[a-f0-9]{48}$/.test(secret)
      ? secret
      : null;
  },
  store: redisStore,
});

export const executeLimiter = rateLimit({
  name: "execute",
  limit: 60,
  windowMs: 60_000,
  key: (req) => (req as AuthedRequest).auth?.tenantId ?? null,
  store: redisStore,
});