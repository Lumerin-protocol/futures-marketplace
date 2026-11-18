/**
 * Fixed-width print of the hashprice change shown beside the index.
 *
 * A proportional digit, a missing tens place, or a sign that appears only on
 * the way down was changing the width of that print and pushing the stats
 * next to it. The sign always takes a slot, and the integer part is padded
 * with a figure space so every value inside the reservation is the same length.
 * A longer integer part is kept whole rather than clipped.
 */

/** Same width as a tabular digit. */
export const FIGURE_SPACE = "\u2007";

/** Integer places reserved for both the dollar delta and the percent. */
export const PRICE_CHANGE_INTEGER_DIGITS = 2;

export type ReservedSignedParts = {
  sign: "+" | "-";
  ints: string;
  frac: string;
};

export const reservedSigned = (value: number, integerDigits: number): ReservedSignedParts => {
  const sign = value < 0 ? "-" : "+";
  const [ints = "0", frac = "00"] = Math.abs(value).toFixed(2).split(".");
  return {
    sign,
    ints: ints.length >= integerDigits ? ints : ints.padStart(integerDigits, FIGURE_SPACE),
    frac,
  };
};
