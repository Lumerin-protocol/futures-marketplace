import { BigInt } from "@graphprotocol/graph-ts";
import { SettlementPriceRecorded } from "../../generated/Futures/Futures";
import { getOrCreateFuturesExpiration } from "../internal/store";

/// Pins the cash-settlement price onto the expiration entity. The contract emits this
/// exactly once per `expirationAt` (set-once), but we guard idempotently anyway: a second
/// event for an already-priced expiration is ignored rather than overwriting the pin.
export function handleSettlementPriceRecorded(event: SettlementPriceRecorded): void {
  const expiration = getOrCreateFuturesExpiration(event.params.expirationAt);
  // Binding to a typed local first avoids an AssemblyScript compiler crash on a direct
  // `entity.nullableScalar != null` comparison; a non-null reference is truthy.
  const existing: BigInt | null = expiration.settlementPrice;
  if (existing) return;

  expiration.settlementPrice = event.params.price;
  expiration.settledAt = event.block.timestamp;
  expiration.recordedBy = event.params.recordedBy;
  expiration.recordTransactionHash = event.transaction.hash;
  expiration.recordBlockNumber = event.block.number;
  expiration.save();
}
