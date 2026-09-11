/// Signed-BigInt helpers used by the per-(user, expirationAt) net-quantity
/// bookkeeping. Quantities in the futures market are whole contract counts, but
/// they are carried as BigInt so the mappings never truncate an on-chain int256
/// (and so the arithmetic matches the perps indexer leg for leg).

import { BigInt } from "@graphprotocol/graph-ts";

export function isSameSign(a: BigInt, b: BigInt): boolean {
  const zero = BigInt.zero();
  return (a.gt(zero) && b.gt(zero)) || (a.lt(zero) && b.lt(zero));
}

export function absBigInt(a: BigInt): BigInt {
  return a.lt(BigInt.zero()) ? a.neg() : a;
}

export function minBigInt(a: BigInt, b: BigInt): BigInt {
  return a.lt(b) ? a : b;
}
