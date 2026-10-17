import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { apiLog } from "./logger";
import type { AuthedRequest } from "./auth/middleware";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// never log the raw URL: /hooks/<secret> is a credential, and query strings can carry anything.
function safePath(url: string): string {
  const path = url.split("?")[0];
  if (path === "/hooks" || path.startsWith("/hooks/")) return "/hooks/:secret";
  return path.replace(UUID, ":id").slice(0, 200);
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const path = safePath(req.originalUrl);
    const status = res.statusCode;
    const auth = (req as AuthedRequest).auth;
    const level = path === "/health" ? "debug" : status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    apiLog[level](
      { requestId, method: req.method, path, status, durationMs, tenantId: auth?.tenantId, userId: auth?.userId },
      "request completed"
    );
  });

  next();
}