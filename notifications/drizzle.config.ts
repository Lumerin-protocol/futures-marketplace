import { defineConfig } from "drizzle-kit";
import { config } from "./config/env.ts";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: config.DATABASE_URL,
  },
});
