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

/// PriceLevel id: "{expirationAt}-{price}-{bid|ask}".
export function priceLevelId(
  expirationAt: BigInt,
  price: BigInt,
  isBid: boolean
): string {
  return (
    expirationAt.toString() +
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
/// (`expirationAt`). One entity per expiration, keyed solely by the timestamp so that
/// any entity carrying a `expirationAt` can resolve its expiration via the same key.
export function futuresExpirationId(expirationAt: BigInt): Bytes {
  return bigIntToFixed32(expirationAt);
}

/// (user, expirationAt) pointer key: 20-byte address ++ 32-byte expirationAt (full BigInt range).
export function userDeliveryPointerId(
  user: Address,
  expirationAt: BigInt
): Bytes {
  return changetype<Bytes>(user).concat(bigIntToFixed32(expirationAt));
}

/// Sentinel byte placed between concatenated id components. `0xff` is chosen
/// because `positionSessionId` digits (UTF-8 encoded) cannot contain it — so a
/// `0xff` byte cannot accidentally appear inside a component. Without a
/// separator, components like `Address` (always 20 B) and `sessionId` (variable
/// length string) could in principle collide across different inputs.
const ID_SEP: Bytes = Bytes.fromHexString("0xff") as Bytes;

/// Trade aggregate id: tx hash ++ sep ++ user ++ sep ++ sessionId.
/// `sessionId` is included so that a single tx spanning more than one
/// PositionSession (a flip closes one session and opens another) produces one
/// Trade row per session — preventing the new session's first trade from
/// inheriting the prior session's realizedPnl.
export function tradeAggregateId(txHash: Bytes, user: Address, sessionId: string): Bytes {
  return txHash
    .concat(ID_SEP)
    .concat(changetype<Bytes>(user))
    .concat(ID_SEP)
    .concat(Bytes.fromUTF8(sessionId));
}

/// Per-leg Fill id: tx hash ++ log index ++ leg index. Fills are immutable, one
/// per (OrderMatched, side), so the leg index disambiguates the taker leg from
/// the maker leg — and, on a flip, the closing leg from the re-opening one.
export function fillId(txHash: Bytes, logIndex: BigInt, legIndex: i32): Bytes {
  return txHash.concatI32(logIndex.toI32()).concatI32(legIndex);
}
