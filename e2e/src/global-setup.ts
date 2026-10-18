import { formatEther } from "viem";
import { redactRpcUrl } from "./chain/clients";
import { Protocol } from "./chain/protocol";
import { type E2EEnv, loadE2EEnv } from "./env";
import { NodeSigner } from "./wallet/node-signer";

/** Prints what the run is pointed at, so a failing report shows the setup it ran against. */
export default async function globalSetup(): Promise<void> {
  const env = loadE2EEnv();
  console.log(
    `[hpdx-e2e] target=${env.target} ui=${env.baseURL}${env.startWebServer ? " (local vite)" : ""} ` +
      `chain=${env.chainId} rpc=${redactRpcUrl(env.rpcUrl)} subgraph=${env.subgraph ? "on" : "off"}`,
  );
  if (env.startWebServer) await assertServedChain(env);

  if (!env.fundedPrivateKey) {
    console.log("[hpdx-e2e] E2E_WALLET_PRIVATE_KEY is not set: using a throwaway wallet, funded scenarios will skip.");
    return;
  }
  const signer = new NodeSigner({ privateKey: env.fundedPrivateKey, rpcUrl: env.rpcUrl, chainId: env.chainId });
  try {
    const protocol = new Protocol(env, signer);
    const [eth, wallet, vault] = await Promise.all([
      protocol.ethBalance(),
      protocol.walletUsdc(),
      protocol.vaultUsdc(),
    ]);
    console.log(
      `[hpdx-e2e] wallet ${signer.address}: ${Number(formatEther(eth)).toFixed(5)} ETH, ` +
        `${wallet.toFixed(2)} USDC in wallet, ${vault.toFixed(2)} USDC in vault`,
    );
  } catch (error) {
    console.warn(`[hpdx-e2e] could not read balances for ${signer.address}: ${(error as Error).message}`);
  }
}

/**
 * When reuseExistingServer is on, Playwright may reuse a dev server already
 * listening on the port, which may have been started for another environment.
 * Vite inlines REACT_APP_CHAIN_ID into the module it serves, so compare that
 * with the chain the wallet signs for.
 */
async function assertServedChain(env: E2EEnv): Promise<void> {
  const response = await fetch(new URL("/src/config/chains.ts", env.baseURL), {
    signal: AbortSignal.timeout(30_000),
  }).catch((error: Error) => {
    if (error.name !== "TimeoutError") return undefined;
    throw new Error(
      `The UI at ${env.baseURL} accepted the connection but did not answer within 30s ` +
        "(a dev server suspended with Ctrl+Z does this). Stop it or set E2E_UI_PORT to a free port.",
    );
  });
  if (!response?.ok) return;
  const served = (await response.text()).match(/chains\[\s*["']?(\d+)["']?\s*\]/)?.[1];
  if (served && Number(served) !== env.chainId) {
    throw new Error(
      `The UI at ${env.baseURL} serves chain ${served}, but target "${env.target}" signs for chain ${env.chainId}. ` +
        "Stop that dev server (or set E2E_UI_PORT to a free port) and run again.",
    );
  }
}
