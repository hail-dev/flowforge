  import { Pool } from "pg";
  import { env } from "./env";
  import { workerLog } from "@flowforge/core";

  export const pool = new Pool({ connectionString: env.DATABASE_URL });

  pool.on("error", (err) => {
    workerLog.error({ err, component: "postgres" }, "pool error");
  });