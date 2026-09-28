import { getWalletClient } from "wagmi/actions";
import { config } from "./wagmi";

const WALLET_NOT_READY_MESSAGE = "Wallet not ready. Please reconnect and try again.";

/**
 * Resolve the active connector at action time instead of relying on a
 * useWalletClient query snapshot captured during render. AppKit can publish the
 * connected account before that query has populated its client, especially
 * while restoring an injected-wallet session.
 */
export async function requireWalletClient() {
  try {
    return await getWalletClient(config);
  } catch (cause) {
    const error = new Error(WALLET_NOT_READY_MESSAGE);
    error.cause = cause;
    throw error;
  }
}
