import { describe, expect, test } from "vitest";
import { formatFeeAmount, formatFundingAndTradingFees } from "./feeDisplay";

const usdc = (amount: number) => BigInt(Math.round(amount * 1e6));

describe("formatFeeAmount", () => {
  test("a fee the account paid is marked minus", () => {
    expect(formatFeeAmount(usdc(1.5))).toBe("−1.50");
  });

  test("a rebate the account received is marked plus", () => {
    expect(formatFeeAmount(usdc(-0.25))).toBe("+0.25");
  });

  test("zero has no sign", () => {
    expect(formatFeeAmount(0n)).toBe("0.00");
  });
});

describe("formatFundingAndTradingFees", () => {
  test("shows funding, then trading, on the same sign convention", () => {
    expect(formatFundingAndTradingFees(usdc(1), usdc(-1))).toBe("−1.00 / +1.00");
  });
});
