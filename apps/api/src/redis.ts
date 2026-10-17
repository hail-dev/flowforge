import { Redis } from "ioredis";
import { apiLog } from "./logger";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

redis.on("error", (err) => {
    apiLog.error({ err, component: "redis" }, "client error");
});