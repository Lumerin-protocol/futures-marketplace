import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { type Address, type Hex, isAddress, zeroAddress } from "viem";
import { z } from "zod";

export const E2E_ROOT = path.resolve(import.meta.dirname, "..");
export const REPO_ROOT = path.resolve(E2E_ROOT, "..");
export const UI_ROOT = path.join(REPO_ROOT, "ui");

export type Target = "dev" | "local";

const TARGET_DEFAULTS: Record<Target, { rpcUrl: string; chainId: number; subgraph: boolean }> = {
  dev: { rpcUrl: "https://sepolia.base.org", chainId: 84532, subgraph: true },
  local: { rpcUrl: "http://127.0.0.1:8545", chainId: 31337, subgraph: false },
};

const flag = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((value) => value === "true" || value === "1" || value === "yes");

/** The UI's amount inputs take at most two decimals. */
const usdcAmount = z.coerce
  .number()
  .positive()
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, "at most 2 decimals");

const schema = z.object({
  E2E_TARGET: z.enum(["dev", "local"]).default("dev"),
  E2E_BASE_URL: z.url().optional(),
  // Not the UI's own 3001, so a developer's `npm run dev` (any APP_ENV, or suspended) never gets reused.
  E2E_UI_PORT: z.coerce.number().int().min(1).max(65535).default(3101),
  E2E_RPC_URL: z.url().optional(),
  E2E_CHAIN_ID: z.coerce.number().int().positive().optional(),
  E2E_WALLET_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be 0x followed by 64 hex characters")
    .optional(),
  E2E_DEPOSIT_AMOUNT: usdcAmount.default(5),
  E2E_WITHDRAW_AMOUNT: usdcAmount.default(1),
  E2E_ORDER_QTY: z.coerce.number().int().positive().default(1),
  E2E_PRICE_OFFSET_PCT: z.coerce.number().positive().max(40).default(3),
  E2E_MIN_COLLATERAL: z.coerce.number().nonnegative().default(25),
  E2E_SUBGRAPH: flag.optional(),
  E2E_CONSOLE_ERROR_ALLOWLIST: z.string().optional(),
});

export interface E2EEnv {
  target: Target;
  /** Where the browser points. */
  baseURL: string;
  /** True when Playwright has to start the UI itself (no E2E_BASE_URL). */
  startWebServer: boolean;
  uiPort: number;
  rpcUrl: string;
  chainId: number;
  /** Key of the funded test wallet; undefined when E2E_WALLET_PRIVATE_KEY is unset. */
  fundedPrivateKey?: Hex;
  hasFundedWallet: boolean;
  /** Whether the target's subgraph (order book, orders, positions, history) is reachable. */
  subgraph: boolean;
  amounts: {
    deposit: number;
    withdraw: number;
    orderQty: number;
    priceOffsetPct: number;
    minCollateral: number;
  };
  contracts: { futures?: Address; perps?: Address };
  consoleErrorAllowlist: RegExp[];
}

let cached: E2EEnv | undefined;

/** Reads e2e/.env + shell, validates it and fails fast with a readable message. */
export function loadE2EEnv(): E2EEnv {
  if (cached) return cached;

  const dotEnv = path.join(E2E_ROOT, ".env");
  if (existsSync(dotEnv)) process.loadEnvFile(dotEnv);

  const raw = Object.fromEntries(
    Object.entries(process.env)
      .filter(([key, value]) => key.startsWith("E2E_") && value !== undefined && value.trim() !== "")
      .map(([key, value]) => [key, value?.trim()]),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid e2e environment (e2e/.env or shell):\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const target = e.E2E_TARGET;
  const defaults = TARGET_DEFAULTS[target];
  const ui = resolveUiEnv(target);

  const chainId = e.E2E_CHAIN_ID ?? (Number(ui.REACT_APP_CHAIN_ID) || defaults.chainId);
  const uiChainId = Number(ui.REACT_APP_CHAIN_ID);
  if (!e.E2E_BASE_URL && uiChainId && uiChainId !== chainId) {
    throw new Error(
      `E2E_CHAIN_ID=${chainId} but the UI is configured for REACT_APP_CHAIN_ID=${uiChainId} (config/${target}.env).`,
    );
  }

  cached = {
    target,
    baseURL: e.E2E_BASE_URL ?? `http://localhost:${e.E2E_UI_PORT}`,
    startWebServer: !e.E2E_BASE_URL,
    uiPort: e.E2E_UI_PORT,
    rpcUrl: e.E2E_RPC_URL ?? ui.REACT_APP_READ_ONLY_ETH_NODE_URL ?? defaults.rpcUrl,
    chainId,
    fundedPrivateKey: e.E2E_WALLET_PRIVATE_KEY as Hex | undefined,
    hasFundedWallet: Boolean(e.E2E_WALLET_PRIVATE_KEY),
    subgraph: e.E2E_SUBGRAPH ?? defaults.subgraph,
    amounts: {
      deposit: e.E2E_DEPOSIT_AMOUNT,
      withdraw: e.E2E_WITHDRAW_AMOUNT,
      orderQty: e.E2E_ORDER_QTY,
      priceOffsetPct: e.E2E_PRICE_OFFSET_PCT,
      minCollateral: e.E2E_MIN_COLLATERAL,
    },
    contracts: {
      futures: nonZeroAddress(ui.REACT_APP_FUTURES_TOKEN_ADDRESS),
      perps: nonZeroAddress(ui.REACT_APP_PERPS_TOKEN_ADDRESS),
    },
    consoleErrorAllowlist: (e.E2E_CONSOLE_ERROR_ALLOWLIST ?? "")
      .split(",")
      .map((pattern) => pattern.trim())
      .filter(Boolean)
      .map((pattern) => new RegExp(pattern)),
  };
  return cached;
}

/**
 * The values the UI itself ends up with, in ui/load-env.ts order:
 * shell > ui/.env > repo .env > config/<target>.env.
 */
function resolveUiEnv(target: Target): Record<string, string | undefined> {
  return {
    ...readEnvFile(path.join(REPO_ROOT, "config", `${target}.env`)),
    ...readEnvFile(path.join(REPO_ROOT, ".env")),
    ...readEnvFile(path.join(UI_ROOT, ".env")),
    ...process.env,
  };
}

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return parseEnv(readFileSync(file, "utf8")) as Record<string, string>;
}

function nonZeroAddress(value: string | undefined): Address | undefined {
  if (!value || !isAddress(value, { strict: false })) return undefined;
  return value.toLowerCase() === zeroAddress ? undefined : (value as Address);
}
