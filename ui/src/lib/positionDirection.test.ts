import { describe, expect, it } from "vitest";
import { sessionIsLong } from "./positionDirection";

describe("which way a session was pointing", () => {
  it("reads an open session off its net quantity", () => {
    expect(sessionIsLong(5)).toBe(true);
    expect(sessionIsLong(-5)).toBe(false);
  });

  it("ignores the fill while the session is open", () => {
    // The newest fill of an open long could itself be a partial sell.
    expect(sessionIsLong(5, { netQuantityAfter: 5, tradeQuantity: -3 })).toBe(true);
  });

  it("reverses the fill that closed the session", () => {
    // Closed by selling, so it was long.
    expect(sessionIsLong(0, { netQuantityAfter: 0, tradeQuantity: -8 })).toBe(true);
    // Closed by buying, so it was short.
    expect(sessionIsLong(0, { netQuantityAfter: 0, tradeQuantity: 8 })).toBe(false);
  });

  it("reads a session that expired while still open off the fill's net quantity", () => {
    // No fill closed it, so the last one leaves the position standing.
    expect(sessionIsLong(0, { netQuantityAfter: 4, tradeQuantity: 4 })).toBe(true);
    expect(sessionIsLong(0, { netQuantityAfter: -4, tradeQuantity: -4 })).toBe(false);
  });

  it("gives the same answer from any fill of the session", () => {
    // Only the closing fill can leave the session flat, so an intermediate fill
    // resolves through the net-quantity branch and agrees. This is what makes
    // the arbitrary ordering of two fills in one block harmless.
    const longSession = [
      { netQuantityAfter: 10, tradeQuantity: 10 }, // opened
      { netQuantityAfter: 4, tradeQuantity: -6 }, // partial close
      { netQuantityAfter: 0, tradeQuantity: -4 }, // closed
    ];
    for (const fill of longSession) expect(sessionIsLong(0, fill)).toBe(true);

    const shortSession = [
      { netQuantityAfter: -10, tradeQuantity: -10 },
      { netQuantityAfter: -4, tradeQuantity: 6 },
      { netQuantityAfter: 0, tradeQuantity: 4 },
    ];
    for (const fill of shortSession) expect(sessionIsLong(0, fill)).toBe(false);
  });

  it("takes the values as they arrive off the wire", () => {
    expect(sessionIsLong("0", { netQuantityAfter: "0", tradeQuantity: "-8" })).toBe(true);
    expect(sessionIsLong(0n, { netQuantityAfter: 0n, tradeQuantity: 8n })).toBe(false);
  });

  it("keeps the sign of a quantity too large for a double", () => {
    const huge = "-12345678901234567890";
    expect(sessionIsLong(huge)).toBe(false);
    expect(sessionIsLong(0, { netQuantityAfter: 0, tradeQuantity: huge })).toBe(true);
  });

  it("falls back to long for a flat session with no fill", () => {
    expect(sessionIsLong(0)).toBe(true);
    expect(sessionIsLong(0, null)).toBe(true);
  });
});
