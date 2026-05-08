import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";

function padLeft(s: string, len: i32, char: string): string {
  if (s.length >= len) return s;
  let out = "";
  for (let i = 0; i < len - s.length; i++) out += char;
  return out + s;
}

/// Deterministic position session ID: blockNumber (12 digits) + logIndex (6 digits) + side suffix.
/// Stable regardless of indexer start block.
export function positionSessionId(
  blockNumber: BigInt,
  logIndex: BigInt,
  side: i32
): string {
  return (
    padLeft(blockNumber.toString(), 12, "0") +
    padLeft(logIndex.toString(), 6, "0") +
    padLeft(side.toString(), 2, "0")
  );
}

/// Per-event id: tx hash + log index. Used for immutable event-sourced entities.
export function createEventId(txHash: Bytes, logIndex: BigInt): Bytes {
  return txHash.concatI32(logIndex.toI32());
}

/// PriceLevel id: "{deliveryAt}-{price}-{bid|ask}".
export function priceLevelId(
  deliveryAt: BigInt,
  price: BigInt,
  isBid: boolean
): string {
  return (
    deliveryAt.toString() +
    "-" +
    price.toString() +
    "-" +
    (isBid ? "bid" : "ask")
  );
}

/// (user, deliveryAt) pointer key: 20-byte address ++ 8-byte deliveryAt (big-endian seconds since epoch fits in u64).
export function userDeliveryPointerId(
  user: Address,
  deliveryAt: BigInt
): Bytes {
  return changetype<Bytes>(user).concatI32(deliveryAt.toI32());
}

/// Order aggregate id: tx hash ++ user ++ price ++ deliveryAt ++ side.
export function orderAggregateId(
  txHash: Bytes,
  user: Address,
  price: BigInt,
  deliveryAt: BigInt,
  isBuy: boolean
): Bytes {
  return txHash
    .concat(changetype<Bytes>(user))
    .concat(changetype<Bytes>(Bytes.fromHexString(padLeft(price.toHexString().slice(2), 64, "0"))))
    .concatI32(deliveryAt.toI32())
    .concatI32(isBuy ? 1 : 0);
}

/// Trade aggregate id: tx hash ++ user ++ sessionId.
/// `sessionId` is included so that a single tx that spans more than one
/// PositionSession (e.g. the multi-match flip case where a taker order both
/// closes an existing session via PositionExited and opens a new one via
/// PositionCreated) produces one Trade row per session — preventing the
/// new session's first trade from inheriting the prior session's realizedPnl.
export function tradeAggregateId(txHash: Bytes, user: Address, sessionId: string): Bytes {
  return txHash.concat(changetype<Bytes>(user)).concat(Bytes.fromUTF8(sessionId));
}

/// Fill aggregate id: tx hash ++ user ++ counterparty ++ sessionId.
/// `sessionId` is included for the same reason as `tradeAggregateId`: it
/// scopes each Fill to a single PositionSession so that a same-tx flip
/// against the same counterparty doesn't collapse two distinct sessions
/// into one Fill row (which would leak realizedPnl from the closed session
/// into the freshly-opened one).
export function fillAggregateId(
  txHash: Bytes,
  user: Address,
  counterparty: Address,
  sessionId: string
): Bytes {
  return txHash
    .concat(changetype<Bytes>(user))
    .concat(changetype<Bytes>(counterparty))
    .concat(Bytes.fromUTF8(sessionId));
}
