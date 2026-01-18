const decimals = 10n ** 6n;

// multiply bigint by float number and return bigint
export function mult(a: bigint, b: number) {
  return (a * BigInt(Math.floor(b * Number(decimals)))) / decimals;
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function NowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function clamp(x: number, lo: number | null, hi: number | null): number {
  if (lo !== null) x = Math.max(lo, x);
  if (hi !== null) x = Math.min(hi, x);
  return x;
}

export function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

export function roundToNearest(value: bigint, increment: bigint): bigint {
  return ((value + increment / 2n) / increment) * increment;
}

export function getGasFee(tx: { gasUsed: bigint; effectiveGasPrice: bigint }): bigint {
  return tx.gasUsed * tx.effectiveGasPrice;
}
