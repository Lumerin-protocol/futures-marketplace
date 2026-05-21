import assert from "node:assert/strict";
import { concatHex, type Hex } from "viem";
import type { EntityFields } from "matchstick-ts";

/**
 * Mirrors `userDeliveryPointerId` in `src/ids.ts`:
 *   20-byte address ++ 4-byte little-endian i32(deliveryAt)
 *
 * graph-ts `Bytes.concatI32` writes the i32 in little-endian byte order,
 * so the 4-byte tail is LSB-first.
 */
export function pointerId(user: Hex, deliveryAt: bigint): Hex {
  const value = Number(deliveryAt) | 0; // wrap to i32, same as BigInt.toI32() in AS
  const buf = new Uint8Array(4);
  buf[0] = value & 0xff;
  buf[1] = (value >>> 8) & 0xff;
  buf[2] = (value >>> 16) & 0xff;
  buf[3] = (value >>> 24) & 0xff;
  const tail = `0x${Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  return concatHex([user, tail]).toLowerCase() as Hex;
}

/**
 * Mirrors `priceLevelId` in `src/ids.ts`:
 *   "{deliveryAt}-{price}-bid" | "{deliveryAt}-{price}-ask"
 */
export function priceLevelId(
  deliveryAt: bigint,
  price: bigint,
  isBid: boolean,
): string {
  return `${deliveryAt}-${price}-${isBid ? "bid" : "ask"}`;
}

/**
 * Assert that a sequence of entity rows has non-decreasing `blockNumber`.
 *
 * Useful after v0.3.0 of the matchstick-ts harness made per-event
 * `blockNumber` realistic — previously all entities had `blockNumber=1`
 * which silently passed any monotonicity check.
 */
export function assertBlockNumberMonotonic(
  rows: readonly EntityFields[],
  label: string,
): void {
  for (let i = 1; i < rows.length; i++) {
    const prev = BigInt(String(rows[i - 1].blockNumber));
    const curr = BigInt(String(rows[i].blockNumber));
    assert.ok(
      curr >= prev,
      `${label}: blockNumber must be non-decreasing (row ${i - 1}=${prev}, row ${i}=${curr})`,
    );
  }
}

/**
 * Assert that `Lot` lifecycle timestamps form a non-decreasing chain:
 *   createdAt <= updatedAt
 *   createdAt <= paidAt (if paid)
 *   paidAt <= withdrawnAt (if withdrawn)
 *   createdAt <= closedAt (if closed)
 */
export function assertLotTimestampInvariants(lot: EntityFields): void {
  const createdAt = BigInt(String(lot.createdAt));
  const updatedAt = BigInt(String(lot.updatedAt));
  assert.ok(
    updatedAt >= createdAt,
    `Lot.updatedAt (${updatedAt}) must be >= Lot.createdAt (${createdAt})`,
  );

  if (lot.paidAt != null && String(lot.paidAt) !== "") {
    const paidAt = BigInt(String(lot.paidAt));
    assert.ok(
      paidAt >= createdAt,
      `Lot.paidAt (${paidAt}) must be >= Lot.createdAt (${createdAt})`,
    );
    if (lot.withdrawnAt != null && String(lot.withdrawnAt) !== "") {
      const withdrawnAt = BigInt(String(lot.withdrawnAt));
      assert.ok(
        withdrawnAt >= paidAt,
        `Lot.withdrawnAt (${withdrawnAt}) must be >= Lot.paidAt (${paidAt})`,
      );
    }
  }

  if (lot.closedAt != null && String(lot.closedAt) !== "") {
    const closedAt = BigInt(String(lot.closedAt));
    assert.ok(
      closedAt >= createdAt,
      `Lot.closedAt (${closedAt}) must be >= Lot.createdAt (${createdAt})`,
    );
  }
}

/**
 * Assert that a hex-string field is non-empty and starts with `0x`. Stops
 * tests from accidentally accepting `undefined` or empty strings as a tx
 * hash.
 */
export function assertHexHash(value: unknown, label: string): void {
  assert.ok(
    typeof value === "string" && value.startsWith("0x") && value.length > 2,
    `${label} must be a non-empty 0x-prefixed hex string, got ${String(value)}`,
  );
}
