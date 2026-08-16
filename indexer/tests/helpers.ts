/**
 * Deterministic test data generators and event param helpers.
 * AssemblyScript has no Math.random, so we use seeds for reproducible IDs.
 */
import {
  Address,
  BigInt,
  Bytes,
  DataSourceContext,
  Value,
  ethereum,
} from "@graphprotocol/graph-ts";
import { createMockedFunction, dataSourceMock } from "matchstick-as/assembly/index";
import { Futures } from "../generated/schema";

function padLeft(s: string, len: i32, char: string): string {
  while (s.length < len) {
    s = char + s;
  }
  return s;
}

/// Deterministic address from numeric id. e.g. userAddress(1) => 0x00…01.
export function userAddress(id: i32): Address {
  const hex = padLeft(id.toString(16), 40, "0");
  return Address.fromString("0x" + hex);
}

/// HashPowerFutures contract address used for `dataSource.address()`.
export function contractAddress(): Address {
  return userAddress(255);
}

/// Mock dataSource address + context. The `startBlock` context entry mirrors
/// the production data source context populated from `START_BLOCK_FUTURES` in
/// `subgraph.template.yaml`. Note: matchstick's `setContext` resets the
/// address, so we set both atomically via `setAddressAndContext`.
export function setupDataSourceMock(startBlock: BigInt = BigInt.zero()): void {
  const ctx = new DataSourceContext();
  ctx.set("startBlock", Value.fromBigInt(startBlock));
  dataSourceMock.setAddressAndContext(contractAddress().toHexString(), ctx);
}

/// Deterministic 32-byte id from a numeric seed (orderId / positionId).
export function bytes32Id(seed: i32): Bytes {
  const hex = padLeft(seed.toString(16), 64, "0");
  return Bytes.fromHexString("0x" + hex) as Bytes;
}

/// Deterministic tx hash from a numeric seed.
export function txHash(seed: i32): Bytes {
  const hex = padLeft(seed.toString(16), 64, "0");
  return Bytes.fromHexString("0x" + hex) as Bytes;
}

export function paramAddr(name: string, value: Address): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromAddress(value));
}

export function paramBytes(name: string, value: Bytes): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromBytes(value));
}

export function paramString(name: string, value: string): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromString(value));
}

export function paramUint(name: string, value: BigInt): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromUnsignedBigInt(value));
}

export function paramInt(name: string, value: BigInt): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromSignedBigInt(value));
}

export function paramBool(name: string, value: boolean): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromBoolean(value));
}

/// PriceLevel ID format: "{expirationAt}-{price}-{bid|ask}".
export function priceLevelKey(expirationAt: BigInt, price: BigInt, isBid: boolean): string {
  return expirationAt.toString() + "-" + price.toString() + "-" + (isBid ? "bid" : "ask");
}

/// 32-byte big-endian hex padding for a non-negative BigInt. Mirrors the
/// `bigIntToFixed32` helper in `src/ids.ts` so test ID-construction stays in sync.
function bigIntHex32(value: BigInt): string {
  return padLeft(value.toHexString().slice(2), 64, "0");
}

/// (user, expirationAt) pointer id: 20-byte address ++ 32-byte expirationAt.
export function pointerKey(user: Address, expirationAt: BigInt): string {
  const bytes = changetype<Bytes>(user).concat(
    Bytes.fromHexString("0x" + bigIntHex32(expirationAt)) as Bytes,
  );
  return bytes.toHexString();
}

/// Mark every contract getter consumed by `loadFuturesFromContract` as
/// reverted. Lets handlers run `getOrCreateFutures()` from scratch in tests
/// without pre-creating the singleton, while still falling through to default
/// values (the production code uses `try_*` and skips on revert).
export function mockFuturesContractCallsAsReverted(): void {
  const addr = contractAddress();
  const getters: string[][] = [
    ["priceOracle", "priceOracle():(address)"],
    ["minimumPriceIncrement", "minimumPriceIncrement():(uint256)"],
    ["makerFeeBps", "makerFeeBps():(int16)"],
    ["takerFeeBps", "takerFeeBps():(int16)"],
    ["liquidationFeeBps", "liquidationFeeBps():(uint16)"],
    ["liquidatorShareBps", "liquidatorShareBps():(uint16)"],
    ["portfolioMargin", "portfolioMargin():(address)"],
    ["CONTRACT_SIZE_HPS_DAY", "CONTRACT_SIZE_HPS_DAY():(uint256)"],
    ["expirationIntervalDays", "expirationIntervalDays():(uint8)"],
    ["futureExpirationDatesCount", "futureExpirationDatesCount():(uint8)"],
    ["firstFutureExpirationDate", "firstFutureExpirationDate():(uint256)"],
    ["collectedFeesBalance", "collectedFeesBalance():(uint256)"],
  ];
  for (let i = 0; i < getters.length; i++) {
    createMockedFunction(addr, getters[i][0], getters[i][1]).reverts();
  }
}

/// Pre-create the Futures singleton so handlers don't try to call into the
/// (unmocked) on-chain contract during tests.
export function setupFutures(): void {
  const f = new Futures(0);
  f.contractAddress = changetype<Bytes>(contractAddress());
  f.hashrateOracleAddress = Bytes.empty();
  f.portfolioMarginAddress = Bytes.empty();
  f.startBlock = BigInt.zero();
  f.minimumPriceIncrement = BigInt.zero();
  f.makerFeeBps = 0;
  f.takerFeeBps = 0;
  f.liquidationFeeBps = 0;
  f.liquidatorShareBps = 0;
  f.contractSizeHpsDay = BigInt.zero();
  f.expirationIntervalDays = 0;
  f.futureExpirationDatesCount = 0;
  f.firstFutureExpirationDate = BigInt.zero();
  f.quantityDecimals = 0;
  f.collectedFeesBalance = BigInt.zero();
  f.totalUsers = 0;
  f.totalOrders = 0;
  f.activeOrders = 0;
  f.totalTrades = 0;
  f.totalFills = 0;
  f.totalVolume = BigInt.zero();
  f.totalLiquidations = 0;
  f.totalBadDebt = BigInt.zero();
  f.initializedAt = BigInt.zero();
  f.lastUpdatedAt = BigInt.zero();
  f.save();
}

/// Default tx hash matchstick uses for `newTypedMockEventWithParams<…>`.
export const MOCK_TX_HASH = Bytes.fromHexString(
  "0xa16081f360e3847006db660bae1c6d1b2e17ec2a",
) as Bytes;

/// Bump tx hash + block + logIndex on a mock event so it lands in a fresh
/// "transaction" — required when chaining handlers that share aggregate IDs
/// keyed by tx hash (Fill, Trade, Order). `seed` should be unique per nudge.
export function nudgeTx(event: ethereum.Event, seed: i32): void {
  const hex = padLeft(seed.toString(16), 40, "0");
  event.transaction.hash = Bytes.fromHexString("0x" + hex) as Bytes;
  event.block.number = BigInt.fromI32(seed);
  event.logIndex = BigInt.fromI32(seed);
}

const ID_SEP: Bytes = Bytes.fromHexString("0xff") as Bytes;

/// Tx hash that matches the `nudgeTx` helper above for predictable reads.
export function nudgedTxHash(seed: i32): Bytes {
  const hex = padLeft(seed.toString(16), 40, "0");
  return Bytes.fromHexString("0x" + hex) as Bytes;
}

/// Event id used by BadDebtEvent: txHash.concatI32(logIndex).
/// Default matchstick logIndex is 1.
export function eventIdHex(logIndex: i32 = 1): string {
  return MOCK_TX_HASH.concatI32(logIndex).toHexString();
}

/// PositionSession id: blockNumber (12) + logIndex (6) + leg (2).
/// Mirrors `src/ids.ts#positionSessionId`.
export function sessionKey(blockNumber: BigInt, logIndex: BigInt, leg: i32): string {
  return (
    padLeft(blockNumber.toString(), 12, "0") +
    padLeft(logIndex.toString(), 6, "0") +
    padLeft(leg.toString(), 2, "0")
  );
}

/// Trade aggregate id: tx hash ++ sep ++ user ++ sep ++ sessionId.
/// Mirrors `src/ids.ts#tradeAggregateId`.
export function tradeAggKey(txHashBytes: Bytes, user: Address, sessionId: string): string {
  return txHashBytes
    .concat(ID_SEP)
    .concat(changetype<Bytes>(user))
    .concat(ID_SEP)
    .concat(Bytes.fromUTF8(sessionId))
    .toHexString();
}

/// Per-leg Fill id: tx hash ++ log index ++ leg index. Mirrors `src/ids.ts#fillId`.
export function fillKey(txHashBytes: Bytes, logIndex: BigInt, leg: i32): string {
  return txHashBytes.concatI32(logIndex.toI32()).concatI32(leg).toHexString();
}
