import type { BrowserContext } from "@playwright/test";
import type { Address } from "viem";
import type { NodeSigner, SentTransaction } from "./node-signer";
import { type InPageWalletConfig, injectMockWallet } from "./provider.inpage";

/** The name AppKit lists the wallet under in its Connect view. */
export const MOCK_WALLET_NAME = "E2E Mock Wallet";
/** EIP-6963 rdns; wagmi uses it as the connector id, AppKit as `wallet-selector-<id>`. */
export const MOCK_WALLET_RDNS = "io.hpdx.e2e-wallet";

const BRIDGE_BINDING = "__e2eWalletBridge";
const AUTHORIZED_STORAGE_KEY = "__e2e_wallet_authorized";
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#5b5bd6"/>' +
  '<text x="16" y="20" font-size="10" font-family="sans-serif" text-anchor="middle" fill="#fff">E2E</text></svg>';

export interface MockWallet {
  readonly address: Address;
  readonly name: string;
  readonly rdns: string;
  readonly signer: NodeSigner;
  /** Transactions the UI sent through the wallet since it was installed in this context. */
  pageTransactions(): SentTransaction[];
}

/**
 * Puts the mock wallet into every page of `context`: an EIP-1193 provider on
 * `window.ethereum`, announced over EIP-6963, bridged to `signer` in Node.
 */
export async function installMockWallet(context: BrowserContext, signer: NodeSigner): Promise<MockWallet> {
  const installedAt = Date.now();
  await context.exposeBinding(BRIDGE_BINDING, (_source, payload: { method: string; params?: unknown[] }) =>
    signer.handleRequest(payload),
  );
  const config: InPageWalletConfig = {
    address: signer.address,
    chainId: signer.chain.id,
    bindingName: BRIDGE_BINDING,
    storageKey: AUTHORIZED_STORAGE_KEY,
    info: {
      uuid: crypto.randomUUID(),
      name: MOCK_WALLET_NAME,
      icon: `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString("base64")}`,
      rdns: MOCK_WALLET_RDNS,
    },
  };
  await context.addInitScript(injectMockWallet, config);
  return {
    address: signer.address,
    name: MOCK_WALLET_NAME,
    rdns: MOCK_WALLET_RDNS,
    signer,
    pageTransactions: () => signer.sent.filter((tx) => tx.origin === "page" && tx.at >= installedAt),
  };
}
