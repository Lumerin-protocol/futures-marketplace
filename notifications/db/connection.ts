import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config/env.ts";
import * as schema from "./schema.ts";

export function createConnection() {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });
  process.on("SIGINT", async () => {
    await pool.end().catch(() => {});
  });

  process.on("SIGTERM", async () => {
    await pool.end().catch((err) => {});
  });

  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createConnection>;
