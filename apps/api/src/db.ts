import { Pool } from "pg";
import { apiLog } from "@flowforge/core";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on("error", (err) => {
    apiLog.error({ err, component: "postgres" }, "pool error");
})