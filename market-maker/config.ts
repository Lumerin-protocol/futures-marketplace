import { type Static, type StringOptions, type TUnsafe, Type } from "@sinclair/typebox";
import envSchema from "env-schema";
import { Ajv } from "ajv";
import formatsPlugin from "ajv-formats";

const TypeEthAddress = (opt?: StringOptions) =>
  Type.String({ ...opt, pattern: "^0x[a-fA-F0-9]{40}$" }) as TUnsafe<`0x${string}`>;

const TypePrivateKey = (opt?: StringOptions) =>
  Type.String({ ...opt, pattern: "^0x[a-fA-F0-9]{64}$" }) as TUnsafe<`0x${string}`>;

// Base schema for environment variables
const schema = Type.Object({
  ACTIVE_QUOTING_AMOUNT_RATIO: Type.Number({ minimum: 0, maximum: 1 }),
  CHAIN_ID: Type.Number({ minimum: 0, multipleOf: 1 }),
  COMMIT_HASH: Type.String({ default: "unknown" }),
  DRY_RUN_WALLET_ADDRESS: Type.Optional(TypeEthAddress()),
  DRY_RUN: Type.Boolean({ default: false }),
  // These can come from env or secrets (optional here, required at runtime)
  ETH_NODE_URL: Type.Optional(Type.String({ format: "uri" })),
  FLOAT_AMOUNT: Type.Number({ minimum: 0, multipleOf: 1 }),
  FUTURES_ADDRESS: TypeEthAddress(),
  FUTURES_SUBGRAPH_URL: Type.Optional(Type.String({ format: "uri" })),
  GRID_LEVELS: Type.Number({ minimum: 0, multipleOf: 1 }),
  LOG_LEVEL: Type.String({ default: "info" }),
  MARGIN_CALL_TIME_SECONDS: Type.Number({ minimum: 0, multipleOf: 1, default: 0 }),
  MAX_POSITION: Type.Number({ minimum: 0, multipleOf: 1 }),
  ORACLES_SUBGRAPH_URL: Type.Optional(Type.String({ format: "uri" })),
  PRIVATE_KEY: Type.Optional(TypePrivateKey()),
  RISK_AVERSION: Type.Number({ minimum: 0, multipleOf: 1 }),
  SPREAD_AMOUNT: Type.Number({ minimum: 0, multipleOf: 1 }),
  // Lambda-specific: Secrets Manager ARN and balance thresholds
  SECRETS_ARN: Type.Optional(Type.String()),
  MIN_ETH_BALANCE: Type.String({ default: "10000000000000000" }), // 0.01 ETH in wei
  MIN_USDC_BALANCE: Type.String({ default: "10000000" }), // 10 USDC
});

export type Config = Static<typeof schema>;

// Runtime config includes secrets
export type RuntimeConfig = Omit<Config, 'PRIVATE_KEY' | 'ETH_NODE_URL' | 'FUTURES_SUBGRAPH_URL' | 'ORACLES_SUBGRAPH_URL'> & {
  PRIVATE_KEY: `0x${string}`;
  ETH_NODE_URL: string;
  FUTURES_SUBGRAPH_URL: string;
  ORACLES_SUBGRAPH_URL: string;
  // Parsed bigint values
  RISK_AVERSION: bigint;
  FLOAT_AMOUNT: bigint;
  SPREAD_AMOUNT: bigint;
  GRID_LEVELS: bigint;
  MAX_POSITION: bigint;
  MIN_ETH_BALANCE: bigint;
  MIN_USDC_BALANCE: bigint;
};

// Create custom Ajv instance with format validation
const ajv = new Ajv({
  allErrors: true,
  removeAdditional: true,
  useDefaults: true,
  coerceTypes: true,
});

// Add format validators (including "uri")
formatsPlugin.default(ajv);

export const getConfig = (): Config => {
  const config = envSchema<Config>({
    schema,
    dotenv: true, // load .env if it is there, default: false
    ajv, // Pass our custom Ajv instance with format support
  });

  return config;
};

// Convert config to runtime config with bigint values
export const toRuntimeConfig = (config: Config, secrets?: {
  private_key?: string;
  eth_node_url?: string;
  futures_subgraph_url?: string;
  oracles_subgraph_url?: string;
}): RuntimeConfig => {
  const privateKey = (secrets?.private_key || config.PRIVATE_KEY) as `0x${string}`;
  const ethNodeUrl = secrets?.eth_node_url || config.ETH_NODE_URL;
  const futuresSubgraphUrl = secrets?.futures_subgraph_url || config.FUTURES_SUBGRAPH_URL;
  const oraclesSubgraphUrl = secrets?.oracles_subgraph_url || config.ORACLES_SUBGRAPH_URL;

  if (!privateKey) throw new Error("PRIVATE_KEY is required");
  if (!ethNodeUrl) throw new Error("ETH_NODE_URL is required");
  if (!futuresSubgraphUrl) throw new Error("FUTURES_SUBGRAPH_URL is required");
  if (!oraclesSubgraphUrl) throw new Error("ORACLES_SUBGRAPH_URL is required");

  return {
    ...config,
    PRIVATE_KEY: privateKey,
    ETH_NODE_URL: ethNodeUrl,
    FUTURES_SUBGRAPH_URL: futuresSubgraphUrl,
    ORACLES_SUBGRAPH_URL: oraclesSubgraphUrl,
    RISK_AVERSION: BigInt(config.RISK_AVERSION),
    FLOAT_AMOUNT: BigInt(config.FLOAT_AMOUNT),
    SPREAD_AMOUNT: BigInt(config.SPREAD_AMOUNT),
    GRID_LEVELS: BigInt(config.GRID_LEVELS),
    MAX_POSITION: BigInt(config.MAX_POSITION),
    MIN_ETH_BALANCE: BigInt(config.MIN_ETH_BALANCE),
    MIN_USDC_BALANCE: BigInt(config.MIN_USDC_BALANCE),
  };
};
