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

/// Fixed-width 32-byte big-endian encoding of a non-negative BigInt. Used in
/// composite entity ids so they remain collision-free regardless of value
/// magnitude (and don't truncate timestamps past the i32 horizon — Jan 2038).
function bigIntToFixed32(value: BigInt): Bytes {
  return Bytes.fromHexString(padLeft(value.toHexString().slice(2), 64, "0")) as Bytes;
}

/// FuturesExpiration id: 32-byte big-endian encoding of the expiration timestamp
/// (`deliveryAt`). One entity per expiration, keyed solely by the timestamp so that
/// any entity carrying a `deliveryAt` can resolve its expiration via the same key.
export function futuresExpirationId(deliveryAt: BigInt): Bytes {
  return bigIntToFixed32(deliveryAt);
}

/// (user, deliveryAt) pointer key: 20-byte address ++ 32-byte deliveryAt (full BigInt range).
export function userDeliveryPointerId(
  user: Address,
  deliveryAt: BigInt
): Bytes {
  return changetype<Bytes>(user).concat(bigIntToFixed32(deliveryAt));
}

/// Order aggregate id: tx hash ++ user ++ price (32B) ++ deliveryAt (32B) ++ side (1B).
export function orderAggregateId(
  txHash: Bytes,
  user: Address,
  price: BigInt,
  deliveryAt: BigInt,
  isBuy: boolean
): Bytes {
  const sideByte = Bytes.fromHexString(isBuy ? "0x01" : "0x00") as Bytes;
  return txHash
    .concat(changetype<Bytes>(user))
    .concat(bigIntToFixed32(price))
    .concat(bigIntToFixed32(deliveryAt))
    .concat(sideByte);
}

/// Sentinel byte placed between concatenated id components. `0xff` is chosen
/// because `positionSessionId` digits (UTF-8 encoded) cannot contain it — so a
/// `0xff` byte cannot accidentally appear inside a component. Without a
/// separator, components like `Address` (always 20 B) and `sessionId` (variable
/// length string) could in principle collide across different inputs.
const ID_SEP: Bytes = Bytes.fromHexString("0xff") as Bytes;

/// Trade aggregate id: tx hash ++ sep ++ user ++ sep ++ sessionId.
/// `sessionId` is included so that a single tx that spans more than one
/// PositionSession (e.g. the multi-match flip case where a taker order both
/// closes an existing session via PositionExited and opens a new one via
/// PositionCreated) produces one Trade row per session — preventing the
/// new session's first trade from inheriting the prior session's realizedPnl.
export function tradeAggregateId(txHash: Bytes, user: Address, sessionId: string): Bytes {
  return txHash
    .concat(ID_SEP)
    .concat(changetype<Bytes>(user))
    .concat(ID_SEP)
    .concat(Bytes.fromUTF8(sessionId));
}

/// Fill aggregate id: tx hash ++ sep ++ user ++ sep ++ counterparty ++ sep ++ sessionId.
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
    .concat(ID_SEP)
    .concat(changetype<Bytes>(user))
    .concat(ID_SEP)
    .concat(changetype<Bytes>(counterparty))
    .concat(ID_SEP)
    .concat(Bytes.fromUTF8(sessionId));
}
