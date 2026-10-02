  import express from "express";
  import { env } from "./env";
  import { pool } from "./db";
  import { redis } from "./redis";
  import { authRouter } from "./auth/routes";
  import { requireAuth, AuthedRequest } from "./auth/middleware";
  import { workflowsRouter } from "./workflows/routes";

  const app = express();
  app.use(express.json());

  app.use("/auth", authRouter);
  app.get("/auth/me", requireAuth, (req: AuthedRequest, res) => {
    res.json({ auth: req.auth });
  });

  app.use("/workflows", workflowsRouter);

  const port = Number(env.API_PORT ?? 3001);

  app.use(express.json());

  async function check(fn: () => Promise<unknown>, timeoutMs = 2000): Promise<"ok" | "down"> {
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
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
    console.log(`flowforge-api listening on http://localhost:${port}`);
  });