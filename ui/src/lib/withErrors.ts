import type { Abi } from "viem";
import { contractErrors as futuresErrors } from "futures-marketplace-abi/ContractErrors.ts";
import { contractErrors as collateralErrors } from "collateral-margin-abi/ContractErrors.ts";
import { contractErrors as perpsErrors } from "derivatives-marketplace-abi/ContractErrors.ts";

type ErrorAbiEntry = {
  type: "error";
  name: string;
  inputs: readonly unknown[];
};

/**
 * Union of custom errors across the product ABIs, deduped by error name so
 * viem's decoder has a single entry per selector.
 */
const contractErrors: readonly ErrorAbiEntry[] = (() => {
  const byName = new Map<string, ErrorAbiEntry>();
  for (const entry of [...futuresErrors, ...collateralErrors, ...perpsErrors] as ErrorAbiEntry[]) {
    if (entry?.type === "error" && entry.name && !byName.has(entry.name)) {
      byName.set(entry.name, entry);
    }
  }
  return [...byName.values()];
})();

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
 * Usage: `abi: withErrors(HashPowerFuturesAbi)`.
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
