import { type Static, type StringOptions, type TUnsafe, Type } from "@sinclair/typebox";
import envSchema from "env-schema";
import { Ajv } from "ajv";
import formatsPlugin from "ajv-formats";

const TypeEthAddress = (opt?: StringOptions) =>
  Type.String({ ...opt, pattern: "^0x[a-fA-F0-9]{40}$" }) as TUnsafe<`0x${string}`>;

const TypePrivateKey = (opt?: StringOptions) =>
  Type.String({ ...opt, pattern: "^0x[a-fA-F0-9]{64}$" }) as TUnsafe<`0x${string}`>;

const schema = Type.Object({
  ACTIVE_QUOTING_AMOUNT_RATIO: Type.Number({ minimum: 0, maximum: 1 }),
  CHAIN_ID: Type.Number({ minimum: 0, multipleOf: 1 }),
  COMMIT_HASH: Type.String({ default: "unknown" }),
  DRY_RUN: Type.Boolean({ default: false }),
  DRY_RUN_WALLET_ADDRESS: Type.Optional(TypeEthAddress()),
  ETH_NODE_URL: Type.String({ format: "uri" }),
  FLOAT_AMOUNT: Type.Number({ minimum: 0, multipleOf: 1 }),
  FUTURES_ADDRESS: TypeEthAddress(),
  GRID_LEVELS: Type.Number({ minimum: 0, multipleOf: 1 }),
  LOG_LEVEL: Type.String(),
  LOOP_INTERVAL_MS: Type.Number({ minimum: 0, multipleOf: 1 }),
  MAX_POSITION: Type.Number({ minimum: 0, multipleOf: 1 }),
  MARGIN_CALL_TIME_SECONDS: Type.Number({ minimum: 0, multipleOf: 1, default: 0 }),
  PRIVATE_KEY: TypePrivateKey(),
  RISK_AVERSION: Type.Number({ minimum: 0, multipleOf: 1 }),
  SPREAD_AMOUNT: Type.Number({ minimum: 0, multipleOf: 1 }),
  SUBGRAPH_API_KEY: Type.String(),
  SUBGRAPH_URL: Type.String({ format: "uri" }),
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
formatsPlugin.default(ajv);

export const getConfig = () => {
  const config = envSchema<Config>({
    schema,
    dotenv: true, // load .env if it is there, default: false
    ajv, // Pass our custom Ajv instance with format support
  });

  return {
    ...config,
    RISK_AVERSION: BigInt(config.RISK_AVERSION),
    FLOAT_AMOUNT: BigInt(config.FLOAT_AMOUNT),
    SPREAD_AMOUNT: BigInt(config.SPREAD_AMOUNT),
    GRID_LEVELS: BigInt(config.GRID_LEVELS),
    MAX_POSITION: BigInt(config.MAX_POSITION),
  };
};
