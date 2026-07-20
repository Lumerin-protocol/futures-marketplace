import assert from "node:assert/strict";
import { concatHex, type Hex } from "viem";
import type { EntityFields } from "matchstick-ts";

/**
 * Mirrors `userDeliveryPointerId` in `src/ids.ts`:
 *   20-byte address ++ 32-byte big-endian deliveryAt
 *
 * Full BigInt range — does NOT truncate past the i32 horizon (Jan 2038).
 */
export function pointerId(user: Hex, deliveryAt: bigint): Hex {
  const tail = `0x${deliveryAt.toString(16).padStart(64, "0")}` as Hex;
  return concatHex([user, tail]).toLowerCase() as Hex;
}

/**
 * Mirrors `futuresExpirationId` in `src/ids.ts`:
 *   32-byte big-endian encoding of the expiration timestamp (deliveryAt).
 */
export function futuresExpirationId(deliveryAt: bigint): Hex {
  return `0x${deliveryAt.toString(16).padStart(64, "0")}`.toLowerCase() as Hex;
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
