import { describe, expect, it } from "vitest";
import { marginsForSameAccount } from "./useGetPortfolioMargins";

const ACCOUNT_A = "0x1111111111111111111111111111111111111111";
const ACCOUNT_B = "0x2222222222222222222222222222222222222222";
const MARGINS = [10n, 5n] as const;

/// Wagmi's `readContract` key. `args[0]` is the account the view was called for.
const readKey = (account: string) =>
  ["readContract", { functionName: "computePortfolioMargins", args: [account] }] as const;

describe("marginsForSameAccount", () => {
  it("keeps the previous pair while the same account's read is in flight", () => {
    expect(marginsForSameAccount(MARGINS, { queryKey: readKey(ACCOUNT_A) }, ACCOUNT_A)).toBe(MARGINS);
  });

  it("matches the account case-insensitively", () => {
    expect(
      marginsForSameAccount(MARGINS, { queryKey: readKey(ACCOUNT_A) }, ACCOUNT_A.toUpperCase()),
    ).toBe(MARGINS);
  });

  it("drops the previous account's pair on a wallet switch", () => {
    expect(marginsForSameAccount(MARGINS, { queryKey: readKey(ACCOUNT_A) }, ACCOUNT_B)).toBeUndefined();
  });

  it("drops the pair when the previous read cannot be tied to an account", () => {
    expect(marginsForSameAccount(MARGINS, { queryKey: ["readContract", {}] }, ACCOUNT_A)).toBeUndefined();
    expect(marginsForSameAccount(MARGINS, undefined, ACCOUNT_A)).toBeUndefined();
    expect(marginsForSameAccount(undefined, { queryKey: readKey(ACCOUNT_A) }, ACCOUNT_A)).toBeUndefined();
    expect(marginsForSameAccount(MARGINS, { queryKey: readKey(ACCOUNT_A) }, undefined)).toBeUndefined();
  });
});
