import { type Static, StringOptions, TUnsafe, Type } from "@sinclair/typebox";
import envSchema from "env-schema";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const TypeEthAddress = (opt?: StringOptions) =>
  Type.String({ ...opt, pattern: "^0x[a-fA-F0-9]{40}$" }) as TUnsafe<`0x${string}`>;

const schema = Type.Object({
  FUTURES_ADDRESS: TypeEthAddress(),
  ETH_NODE_URL: Type.String({ format: "uri" }),
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
  MARGIN_UTILIZATION_WARNING_PERCENT: Type.Number({ minimum: 0, maximum: 100, default: 80 }),
  NOTIFICATIONS_SERVICE_URL: Type.String({ format: "uri" }),
  MULTICALL_ADDRESS: TypeEthAddress(),
  SUBGRAPH_URL: Type.String({ format: "uri" }),
  SUBGRAPH_API_KEY: Type.Optional(Type.String()),
});

export type Config = Static<typeof schema>;

// Create custom Ajv instance with format validation
const ajv = new Ajv({
  allErrors: true,
  removeAdditional: true,
  useDefaults: true,
  coerceTypes: true,
});

// Add format validators (including "uri")
addFormats(ajv);

export const config = envSchema<Config>({
  schema,
  dotenv: true, // load .env if it is there, default: false
  ajv, // Pass our custom Ajv instance with format support
});
