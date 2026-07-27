import type { Abi } from "viem";
import { contractErrors } from "../abi/contractErrors";

/**
 * Cache of merged ABIs keyed by the *source* ABI reference. Because the contract
 * ABIs are module-level constants (stable references), the merged array is created
 * once and reused, so `withErrors(SomeAbi)` returns a stable reference across
 * renders — no per-render allocation and no react-query key churn.
 */
const cache = new WeakMap<object, unknown>();

/**
 * Merge a contract ABI with the shared custom-error ABI (`contractErrors`) so viem
 * can decode reverts (e.g. `OracleStale`, `InvalidPrice`) into named errors instead
 * of opaque hex `data`.
 *
 * The return type is the *original* ABI type, so wagmi/viem keep inferring
 * `functionName`, `args` and return types from your contract's functions; the extra
 * error entries only exist at runtime for decoding.
 *
 * Usage: `abi: withErrors(FuturesAbi)`.
 */
export function withErrors<const TAbi extends Abi | readonly unknown[]>(
  abi: TAbi,
): TAbi {
  const key = abi as unknown as object;
  const cached = cache.get(key);
  if (cached) return cached as TAbi;

  const merged = [
    ...(abi as readonly unknown[]),
    ...contractErrors,
  ] as unknown as TAbi;
  cache.set(key, merged);
  return merged;
}
