import { test as base, expect } from "@playwright/test";
import { generatePrivateKey } from "viem/accounts";
import { Protocol } from "./chain/protocol";
import { type E2EEnv, loadE2EEnv } from "./env";
import { TradingPage } from "./pages/TradingPage";
import { ConsoleErrors } from "./utils/console";
import { installMockWallet, type MockWallet } from "./wallet/install";
import { NodeSigner } from "./wallet/node-signer";

export type WalletKind = "funded" | "throwaway";

interface WorkerFixtures {
  env: E2EEnv;
  /** Signs with E2E_WALLET_PRIVATE_KEY; undefined when none is configured. */
  fundedSigner: NodeSigner | undefined;
  /** A fresh key per worker with no funds: enough to connect and read, never to transact. */
  throwawaySigner: NodeSigner;
  /** Chain reads and the Node-side top-up for the funded wallet. Throws when there is none; specs skip first. */
  protocol: Protocol;
}

interface TestFixtures {
  /** Which key the mock wallet signs with. "funded" falls back to a throwaway key when none is configured. */
  walletKind: WalletKind;
  /** Installed into the context before the first navigation (auto). */
  wallet: MockWallet;
  /** Console errors of the test's page; attached to the report when there are any (auto). */
  consoleErrors: ConsoleErrors;
  trading: TradingPage;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from the destructuring.
  env: [async ({}, use) => use(loadE2EEnv()), { scope: "worker" }],

  fundedSigner: [
    async ({ env }, use) =>
      use(
        env.fundedPrivateKey
          ? new NodeSigner({ privateKey: env.fundedPrivateKey, rpcUrl: env.rpcUrl, chainId: env.chainId })
          : undefined,
      ),
    { scope: "worker" },
  ],

  throwawaySigner: [
    async ({ env }, use) =>
      use(new NodeSigner({ privateKey: generatePrivateKey(), rpcUrl: env.rpcUrl, chainId: env.chainId })),
    { scope: "worker" },
  ],

  protocol: [
    async ({ env, fundedSigner }, use) => {
      if (!fundedSigner) throw new Error("The protocol fixture needs E2E_WALLET_PRIVATE_KEY; skip with SKIP.noFundedWallet.");
      await use(new Protocol(env, fundedSigner));
    },
    { scope: "worker" },
  ],

  walletKind: ["funded", { option: true }],

  wallet: [
    async ({ context, walletKind, fundedSigner, throwawaySigner }, use) => {
      const signer = walletKind === "funded" && fundedSigner ? fundedSigner : throwawaySigner;
      await use(await installMockWallet(context, signer));
    },
    { auto: true },
  ],

  consoleErrors: [
    async ({ page, env }, use, testInfo) => {
      const errors = new ConsoleErrors(page, env.consoleErrorAllowlist);
      await use(errors);
      if (errors.report) await testInfo.attach("console-errors.txt", { body: errors.report, contentType: "text/plain" });
    },
    { auto: true },
  ],

  trading: async ({ page, wallet }, use) => use(new TradingPage(page, wallet)),
});

export { expect };
