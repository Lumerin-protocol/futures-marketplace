import { describe, expect, it } from "vitest";
import { percentForQuantity, quantityAtPercent, snapQuantityDown } from "./sliderSnap";

describe("snapQuantityDown", () => {
  it("floors futures to whole contracts", () => {
    expect(snapQuantityDown(6.9, 0)).toBe(6);
  });

  it("floors perps to six decimals without float noise", () => {
    expect(snapQuantityDown(0.3, 6)).toBe(0.3);
    expect(snapQuantityDown(0.12345678, 6)).toBe(0.123456);
  });
});

describe("quantityAtPercent", () => {
  it("rounds interior positions to the nearest contract", () => {
    expect(quantityAtPercent(40, 1, 0)).toBe(0);
    expect(quantityAtPercent(60, 1, 0)).toBe(1);
    expect(quantityAtPercent(50, 7, 0)).toBe(4); // 3.5 → 4
  });

  it("never exceeds the placeable ceiling", () => {
    expect(quantityAtPercent(100, 6.7, 0)).toBe(6);
    expect(quantityAtPercent(100, 6, 0)).toBe(6);
  });

  it("keeps six decimals for perps", () => {
    expect(quantityAtPercent(33, 1, 6)).toBe(0.33);
    expect(quantityAtPercent(100, 0.5, 6)).toBe(0.5);
  });
});

describe("percentForQuantity", () => {
  it("maps a quantity back onto the track", () => {
    expect(percentForQuantity(3, 6)).toBe(50);
    expect(percentForQuantity(1, 3)).toBe(33);
    expect(percentForQuantity(6, 6)).toBe(100);
  });

  it("clamps and handles an empty ceiling", () => {
    expect(percentForQuantity(9, 6)).toBe(100);
    expect(percentForQuantity(-1, 6)).toBe(0);
    expect(percentForQuantity(1, 0)).toBe(0);
  });
});
