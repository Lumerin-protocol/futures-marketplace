import { loadE2EEnv } from "./env";

const env = loadE2EEnv();

/**
 * Why a scenario cannot run against the current target. Specs pass these to
 * `test.skip(condition, reason)` at the top of a describe, so the report says
 * what to configure rather than just "skipped".
 */
export const SKIP = {
  noFundedWallet: {
    when: !env.hasFundedWallet,
    reason: "E2E_WALLET_PRIVATE_KEY is not set: this scenario signs transactions with a funded test wallet (see e2e/README.md).",
  },
  noSubgraph: {
    when: !env.subgraph,
    reason: `Target "${env.target}" has no subgraph: orders, positions and the order book are read from the indexer.`,
  },
  noPerps: {
    when: !env.contracts.perps,
    reason: "REACT_APP_PERPS_TOKEN_ADDRESS is not set for this target.",
  },
} as const;
