import { useReadContract } from "wagmi";
import { HashPowerFuturesAbi } from "futures-marketplace-abi/HashPowerFutures.ts";
import { withErrors } from "../../lib/withErrors";

/// Reads the `hook` (IPointsHook) address from the Futures contract.
/// Unlike `collateralVault`, the hook is mutable (see `setHook` / `HookUpdated`),
/// so we don't cache it indefinitely.
export function useFuturesHook() {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS as `0x${string}`,
    abi: withErrors(HashPowerFuturesAbi),
    functionName: "hook",
  });
}
