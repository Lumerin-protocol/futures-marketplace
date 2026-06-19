import { useReadContract } from "wagmi";
import { FuturesAbi } from "../../abi/Futures";

/**
 * Reads the on-chain pinned cash-settlement price for one expiration (`deliveryAt`).
 * Returns `0n` until the price has been recorded (by `recordSettlementPrice` or the
 * first `settlePosition` at/after maturity). For lists, prefer the indexed
 * `expiration.settlementPrice` from the subgraph; use this hook when a fresh
 * on-chain value is required (e.g. right after a manual settle).
 */
export function useSettlementPrice(deliveryAt: bigint | undefined) {
  return useReadContract({
    address: process.env.REACT_APP_FUTURES_TOKEN_ADDRESS,
    abi: FuturesAbi,
    functionName: "settlementPrice",
    args: deliveryAt !== undefined ? [deliveryAt] : undefined,
    query: {
      enabled: deliveryAt !== undefined,
      refetchInterval: 10000,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
    },
  });
}
