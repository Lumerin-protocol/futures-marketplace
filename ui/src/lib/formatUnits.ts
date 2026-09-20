import { formatUnits as formatUnitsViem } from "viem";

export type RoundingOpts = {
  maxChars: number; // absolute limit on how many chars to use to display number, to avoid overflow in the UI
  // maxSignificantDigits?: number; // limits on how many significant digits to show
};

type Value = {
  full: string; // rounded value with suffix
  unrounded: string; // unrounded value
  value: string; // rounded value
  suffix: string; // suffix
};

const suffixes = ["", "K", "M", "B", "T"];

// digits in the value itself: a leading "-" is a sign, not a digit, so counting
// it would cost negative numbers a significant digit their positive twins keep
// (PnL of -185.99 would round to -185.90).
function digitCount(n: bigint): number {
  return (n < 0n ? -n : n).toString().length;
}

// formats bigint decimal value to a string with a suffix, considering the number of chars to display
export function formatUnits(input: bigint, decimals: number, opts: RoundingOpts): Value {
  if (opts.maxChars < 3) {
    throw new Error("maxChars must be at least 3");
  }
  const digits = digitCount(input);
  const [exp, suffix] = getExpSuffixDisplay(input, decimals, opts.maxChars);
  let integerDigits = digits - decimals - exp;

  // adjustment for numbers less than 1
  if (integerDigits <= 0) {
    integerDigits = Math.abs(integerDigits) + 1;
  }

  let expToRound = Math.min(decimals, digits) + exp - (opts.maxChars - integerDigits);
  if (expToRound < 0) {
    expToRound = 0;
  }
  const value = formatUnitsViem(round(input, expToRound), exp + decimals);

  return {
    unrounded: formatUnitsViem(input, decimals),
    value,
    suffix,
    full: `${value}${suffix}`,
  };
}

// returns exponent and suffix considering the number of chars to display
function getExpSuffixDisplay(n: bigint, decimals: number, maxChars: number): [exp: number, suffix: string] {
  if (n === 0n) {
    return [0, ""];
  }
  const exp = digitCount(n) - decimals - 1;
  if (exp > maxChars - 1) {
    return getExpSuffix(exp);
  }
  if (exp <= -maxChars) {
    return getExpSuffix(exp);
  }
  return [0, ""];
}

// returns the closest exponent and suffix that can be used to shorten string representation of the number
function getExpSuffix(exp: number): [exp: number, suffix: string] {
  const suffixIndex = Math.floor(exp / 3);
  if (suffixIndex >= suffixes.length) {
    return [exp, `e+${exp}`];
  }
  if (suffixIndex < 0) {
    return [exp, `e${exp}`];
  }
  return [suffixIndex * 3, suffixes[suffixIndex]];
}

// rounds bigint to the nearest multiple of 10^exp
function round(value: bigint, exp: number) {
  const n = 10n ** BigInt(exp);
  return (value / n) * n;
}
