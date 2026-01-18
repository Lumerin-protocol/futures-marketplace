import { type Static, Type } from "typebox";
import envSchema from "env-schema";
import { TypeEthAddress } from "../lib/type.ts";
import { default as Ajv } from "ajv";
import { default as addFormats } from "ajv-formats";

const schema = Type.Object({
  // FUTURES_ADDRESS: TypeEthAddress(),
  // ETH_NODE_URL: Type.String({ format: "url" }),
  // HASHRATE_ORACLE_ADDRESS: TypeEthAddress(),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal("trace"),
      Type.Literal("debug"),
      Type.Literal("info"),
      Type.Literal("warn"),
      Type.Literal("error"),
      Type.Literal("fatal"),
    ],
    { default: "info" }
  ),
  // MARGIN_ALERT_THRESHOLD: Type.Number({ minimum: 0, maximum: 1, default: 0.1 }),
  // MULTICALL_ADDRESS: TypeEthAddress(),
  // SUBGRAPH_URL: Type.String({ format: "uri" }),
  // SUBGRAPH_API_KEY: Type.String({ minLength: 1 }),
  TELEGRAM_BOT_TOKEN: Type.String({ minLength: 1 }),
  // Database configuration
  DATABASE_URL: Type.String({
    format: "uri",
    default: "postgresql://notifications_user:notifications_password@localhost:5432/notifications",
  }),
});

export type Config = Static<typeof schema>;

export const ajv = new Ajv.Ajv({ useDefaults: true, removeAdditional: true });
addFormats.default(ajv);

export const config = envSchema<Config>({
  schema,
  dotenv: true, // load .env if it is there, default: false
  ajv,
});
