import express from "express";
import { env } from "./env";
import { pool } from "./db";
import { redis } from "./redis";
import { authRouter } from "./auth/routes";
import { requireAuth, AuthedRequest } from "./auth/middleware";
import { workflowsRouter } from "./workflows/routes";
import { executeRouter } from "./workflows/executeRoute";
import { hooksRouter } from "./hooks/routes";
import { reconcileSchedules } from "./schedule/sync";
import { executionsRouter } from "./executions/routes";
import { apiLog, installCrashLogging } from "./logger";
import { requestLogger } from "./requestLogger";

const app = express();
installCrashLogging(apiLog);
app.use(requestLogger);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "100kb" }));

app.use("/auth", authRouter);
app.get("/auth/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ auth: req.auth });
});

app.use("/workflows", workflowsRouter);
app.use("/workflows", executeRouter);
app.use("/hooks", hooksRouter);
app.use("/executions", executionsRouter);

if (env.NODE_ENV !== "production") {
  app.post("/dev/echo", (req, res) => {
    res.json({ received: req.body, time: new Date().toISOString() });
  });
}

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const status = (err as { status?: number })?.status;
  const clientError = typeof status === "number" && status >= 400 && status < 500;
  if (clientError) {
    apiLog.warn({ status, errType: (err as Error)?.name, requestId: res.locals.requestId }, "request rejected");
  } else {
    apiLog.error({ err, requestId: res.locals.requestId }, "unhandled error");
  }
  if (res.headersSent) return next(err);
  res.status(clientError ? status! : 500).json({
    error: status === 413 ? "Request body too large" : clientError ? "Invalid request body" : "Internal server error",
  });
});

const port = Number(env.API_PORT ?? 3001);

app.use(express.json());

async function check(
  fn: () => Promise<unknown>,
  timeoutMs = 2000,
): Promise<"ok" | "down"> {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs),
      ),
    ]);
    return "ok";
  } catch {
    return "down";
  }
}

app.get("/health", async (_req, res) => {
  const [postgres, redisStatus] = await Promise.all([
    check(() => pool.query("select 1")),
    check(() => redis.ping()),
  ]);
  const healthy = postgres === "ok" && redisStatus === "ok";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "flowforge-api",
    checks: { postgres, redis: redisStatus },
    time: new Date().toISOString(),
  });
});

app.listen(port, () => {
  apiLog.info({ port }, "api listening");
});

reconcileSchedules()
  .then((n) => apiLog.info({ schedules: n }, "schedules reconciled"))
  .catch((err) => apiLog.error({ err }, "schedule reconcile failed"))
