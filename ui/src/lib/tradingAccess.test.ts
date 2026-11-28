import { describe, expect, test } from "vitest";
import { TRADING_ACCESS_COOKIE, isTradingAllowed, readCookie } from "./tradingAccess";

describe("readCookie", () => {
  test("reads an exact name and ignores lookalikes", () => {
    expect(readCookie("hpdx_allowed=1", TRADING_ACCESS_COOKIE)).toBe("1");
    expect(readCookie("other=1; hpdx_allowed=0", TRADING_ACCESS_COOKIE)).toBe("0");
    expect(readCookie("hpdx_allowed=1; other=9", TRADING_ACCESS_COOKIE)).toBe("1");
    expect(readCookie("not_hpdx_allowed=1", TRADING_ACCESS_COOKIE)).toBeNull();
    expect(readCookie("hpdx_allowed_extra=1", TRADING_ACCESS_COOKIE)).toBeNull();
    expect(readCookie("", TRADING_ACCESS_COOKIE)).toBeNull();
  });

  test("decodes the value and keeps a broken encoding as-is", () => {
    expect(readCookie("hpdx_allowed=1%30", TRADING_ACCESS_COOKIE)).toBe("10");
    expect(readCookie("hpdx_allowed=%", TRADING_ACCESS_COOKIE)).toBe("%");
  });
});

describe("isTradingAllowed", () => {
  test("only the exact value 1 is allowed", () => {
    expect(isTradingAllowed("1", "dev.hashpower.exchange")).toBe(true);
    expect(isTradingAllowed("1", "beta.hashpower.exchange")).toBe(true);
    expect(isTradingAllowed("1", "localhost")).toBe(true);
  });

  test("0, missing, and any other value are restricted", () => {
    for (const value of ["0", "", "true", "yes", "10", " 1"]) {
      expect(isTradingAllowed(value, "beta.hashpower.exchange")).toBe(false);
      expect(isTradingAllowed(value, "dev.hashpower.exchange")).toBe(false);
    }
    expect(isTradingAllowed(null, "beta.hashpower.exchange")).toBe(false);
    expect(isTradingAllowed(null, "dev.hashpower.exchange")).toBe(false);
    expect(isTradingAllowed(null, "hashpower.exchange")).toBe(false);
  });

  test("a missing cookie is allowed only on localhost and 127.0.0.1", () => {
    expect(isTradingAllowed(null, "localhost")).toBe(true);
    expect(isTradingAllowed(null, "127.0.0.1")).toBe(true);
    expect(isTradingAllowed(null, "::1")).toBe(false);
    expect(isTradingAllowed(null, "localhost.example")).toBe(false);
  });

  test("an explicit cookie still restricts local dev", () => {
    expect(isTradingAllowed("0", "localhost")).toBe(false);
    expect(isTradingAllowed("0", "127.0.0.1")).toBe(false);
    expect(isTradingAllowed("", "localhost")).toBe(false);
    expect(isTradingAllowed("true", "127.0.0.1")).toBe(false);
  });
});
