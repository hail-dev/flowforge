import { pino, type Logger } from "pino";

const VALID_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
const requested = process.env.LOG_LEVEL ?? "info";
const level = VALID_LEVELS.includes(requested) ? requested : "info";

export const logger: Logger = pino({
    level,
    base: { app: "flowforge" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: ["authorization", "password", "headers.authorization", "req.headers.authorization"],
    serializers: {
    // body-parser attaches the raw request body to its errors; never log it
    err: (e: unknown) => {
      const s = pino.stdSerializers.err(e as Error) as unknown as Record<string, unknown>;
      if (s && typeof s === "object") delete s.body;
      return s;
    },
  },
})

export const apiLog = logger.child({ service: "api" });
export const workerLog = logger.child({ service: "worker" });

export function installCrashLogging(log: Logger) {
  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    log.fatal({ err: reason }, "unhandled rejection");
    process.exit(1);
  });
}