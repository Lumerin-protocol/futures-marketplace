import { describe, expect, test } from "vitest";
import type { AccountSnapshot, MMParams } from "@hashpower/portfolio-margin";
import type { OrderLeg } from "./orderMargin";
import { positionBefore, snapshotWithFill } from "./orderPreview";

const USER = "0x1111111111111111111111111111111111111111" as const;
const USDC = 1_000_000n;
const usdc = (price: number) => BigInt(Math.round(price * 1e6));
const QTY = 1_000_000n; // perps quantity scale

const params: MMParams = {
  imSpotShock: 10n ** 17n,
  mmSpotShock: 5n * 10n ** 16n,
  tokenDecimals: 6,
  perpQuantityDecimals: 6,
};

const noOrders = { buyDelta: 0n, sellDelta: 0n, buyValue: 0n, sellValue: 0n };

function snapshot(overrides: {
  balance?: bigint;
  perp?: Partial<AccountSnapshot["perp"]>;
  positions?: AccountSnapshot["futures"]["positions"];
}): AccountSnapshot {
  return {
    user: USER,
    balance: overrides.balance ?? 100n * USDC,
    perp: { netQty: 0n, entryPrice: 0n, orders: noOrders, fundingOwed: 0n, ...overrides.perp },
    futures: { positions: overrides.positions ?? [], orders: noOrders },
  };
}

function future(netQuantity: bigint, entryPrice: bigint, expirationAt = 1n) {
  return { expirationAt, netQuantity, netEntryValue: entryPrice * netQuantity, settlementPrice: 0n };
}

const futuresLeg = (quantity: bigint, price: bigint): OrderLeg => ({ venue: "futures", price, quantity });
const perpsLeg = (quantity: bigint, price: bigint): OrderLeg => ({ venue: "perps", price, quantity });

describe("positionBefore", () => {
  test("reads the perps net and the futures leg at the given expiry", () => {
    const snap = snapshot({
      perp: { netQty: 3n * QTY },
      positions: [future(5n, usdc(4)), future(-2n, usdc(4), 2n)],
    });
    expect(positionBefore(snap, { venue: "perps" })).toBe(3n * QTY);
    expect(positionBefore(snap, { venue: "futures" }, 1n)).toBe(5n);
    expect(positionBefore(snap, { venue: "futures" }, 2n)).toBe(-2n);
    expect(positionBefore(snap, { venue: "futures" }, 3n)).toBe(0n);
  });
});

describe("snapshotWithFill — futures", () => {
  test("opening from flat books the fill at its price", () => {
    const after = snapshotWithFill(snapshot({}), params, futuresLeg(5n, usdc(4)), 1n);
    expect(after.futures.positions).toEqual([future(5n, usdc(4))]);
    expect(after.balance).toBe(100n * USDC);
  });

  test("adding keeps the entry value as the sum of fills", () => {
    const snap = snapshot({ positions: [future(5n, usdc(4))] });
    const after = snapshotWithFill(snap, params, futuresLeg(5n, usdc(6)), 1n);
    const [position] = after.futures.positions;
    expect(position.netQuantity).toBe(10n);
    // 5 @ 4 + 5 @ 6 = 50, i.e. an average entry of 5.
    expect(position.netEntryValue).toBe(usdc(50));
    expect(after.balance).toBe(100n * USDC);
  });

  test("reducing realises PnL on the closed part and keeps the average entry", () => {
    const snap = snapshot({ positions: [future(5n, usdc(4))] });
    const after = snapshotWithFill(snap, params, futuresLeg(-2n, usdc(6)), 1n);
    const [position] = after.futures.positions;
    expect(position.netQuantity).toBe(3n);
    expect(position.netEntryValue).toBe(usdc(4) * 3n);
    // Long 2 closed at +2 each.
    expect(after.balance).toBe(100n * USDC + usdc(4));
  });

  test("closing exactly removes the leg and realises the whole PnL", () => {
    const snap = snapshot({ positions: [future(-4n, usdc(5))] });
    const after = snapshotWithFill(snap, params, futuresLeg(4n, usdc(3)), 1n);
    expect(after.futures.positions).toEqual([]);
    // Short 4 covered 2 below entry.
    expect(after.balance).toBe(100n * USDC + usdc(8));
  });

  test("flipping closes the old side and opens the remainder at the fill price", () => {
    const snap = snapshot({ positions: [future(2n, usdc(4))] });
    const after = snapshotWithFill(snap, params, futuresLeg(-5n, usdc(3)), 1n);
    const [position] = after.futures.positions;
    expect(position.netQuantity).toBe(-3n);
    expect(position.netEntryValue).toBe(usdc(3) * -3n);
    // Long 2 closed 1 below entry.
    expect(after.balance).toBe(100n * USDC - usdc(2));
  });

  test("other expiries are left alone", () => {
    const other = future(7n, usdc(2), 9n);
    const snap = snapshot({ positions: [other, future(1n, usdc(4))] });
    const after = snapshotWithFill(snap, params, futuresLeg(1n, usdc(4)), 1n);
    expect(after.futures.positions).toContainEqual(other);
    expect(after.futures.positions).toHaveLength(2);
  });

  test("a futures leg without an expiry is a no-op", () => {
    const snap = snapshot({});
    expect(snapshotWithFill(snap, params, futuresLeg(1n, usdc(4)))).toBe(snap);
  });
});

describe("snapshotWithFill — perps", () => {
  test("adding averages the entry by size", () => {
    const snap = snapshot({ perp: { netQty: 1n * QTY, entryPrice: usdc(4) } });
    const after = snapshotWithFill(snap, params, perpsLeg(3n * QTY, usdc(8)));
    expect(after.perp.netQty).toBe(4n * QTY);
    // (1 × 4 + 3 × 8) / 4 = 7
    expect(after.perp.entryPrice).toBe(usdc(7));
  });

  test("reducing realises PnL in token units and keeps the entry", () => {
    const snap = snapshot({ perp: { netQty: 2n * QTY, entryPrice: usdc(4) } });
    const after = snapshotWithFill(snap, params, perpsLeg(-1n * QTY, usdc(5)));
    expect(after.perp.netQty).toBe(1n * QTY);
    expect(after.perp.entryPrice).toBe(usdc(4));
    expect(after.balance).toBe(100n * USDC + usdc(1));
  });

  test("flipping resets the entry to the fill price", () => {
    const snap = snapshot({ perp: { netQty: -1n * QTY, entryPrice: usdc(4) } });
    const after = snapshotWithFill(snap, params, perpsLeg(3n * QTY, usdc(5)));
    expect(after.perp.netQty).toBe(2n * QTY);
    expect(after.perp.entryPrice).toBe(usdc(5));
    // Short 1 covered 1 above entry.
    expect(after.balance).toBe(100n * USDC - usdc(1));
  });

  test("closing to flat zeroes the entry", () => {
    const snap = snapshot({ perp: { netQty: 1n * QTY, entryPrice: usdc(4) } });
    const after = snapshotWithFill(snap, params, perpsLeg(-1n * QTY, usdc(4)));
    expect(after.perp.netQty).toBe(0n);
    expect(after.perp.entryPrice).toBe(0n);
    expect(after.balance).toBe(100n * USDC);
  });
});
