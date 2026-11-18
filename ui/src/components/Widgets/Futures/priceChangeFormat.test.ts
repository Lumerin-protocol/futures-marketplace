import { describe, expect, it } from "vitest";
import { FIGURE_SPACE, PRICE_CHANGE_INTEGER_DIGITS, reservedSigned } from "./priceChangeFormat";

const printed = (value: number, integerDigits = PRICE_CHANGE_INTEGER_DIGITS) => {
  const { sign, ints, frac } = reservedSigned(value, integerDigits);
  return `${sign}${ints}.${frac}`;
};

describe("reservedSigned", () => {
  it("reserves a sign and two integer digits for a small and a two-digit move", () => {
    expect(reservedSigned(0.08, 2)).toEqual({
      sign: "+",
      ints: `${FIGURE_SPACE}0`,
      frac: "08",
    });
    expect(reservedSigned(-12.4, 2)).toEqual({ sign: "-", ints: "12", frac: "40" });
    expect(printed(0.08).length).toBe(printed(-12.4).length);
    expect(printed(99.99).length).toBe(printed(-0.01).length);
  });

  it("treats zero as an uptick", () => {
    expect(reservedSigned(0, 2).sign).toBe("+");
  });

  it("keeps a value that does not fit the reservation", () => {
    expect(reservedSigned(123.4, 2)).toEqual({ sign: "+", ints: "123", frac: "40" });
    expect(printed(123.4).length).toBeGreaterThan(printed(0.08).length);
  });
});
