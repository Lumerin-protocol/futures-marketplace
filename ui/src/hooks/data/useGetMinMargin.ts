import { useGetPerpsOrderMargin } from "./perps/useGetPerpsOrderMargin";

/**
 * Initial Margin held against a participant's resting orders.
 *
 * Delegates to the engine-wide `orderMarginOf` read. The Futures contract no longer
 * exposes an order-margin view of its own: the engine nets every market's per-side
 * order delta into one portfolio net delta before stressing it, so there is no
 * futures-only slice to report.
 */
export function useGetMinMargin(address: `0x${string}` | undefined) {
  return useGetPerpsOrderMargin(address);
}
