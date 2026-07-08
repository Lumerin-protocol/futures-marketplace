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

/// Futures contract address used for `dataSource.address()`.
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

/// PriceLevel ID format: "{deliveryAt}-{price}-{bid|ask}".
export function priceLevelKey(deliveryAt: BigInt, price: BigInt, isBid: boolean): string {
  return deliveryAt.toString() + "-" + price.toString() + "-" + (isBid ? "bid" : "ask");
}

/// 32-byte big-endian hex padding for a non-negative BigInt. Mirrors the
/// `bigIntToFixed32` helper in `src/ids.ts` so test ID-construction stays in sync.
function bigIntHex32(value: BigInt): string {
  return padLeft(value.toHexString().slice(2), 64, "0");
}

/// (user, deliveryAt) pointer id: 20-byte address ++ 32-byte deliveryAt.
export function pointerKey(user: Address, deliveryAt: BigInt): string {
  const bytes = changetype<Bytes>(user).concat(
    Bytes.fromHexString("0x" + bigIntHex32(deliveryAt)) as Bytes,
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
    ["collateralVault", "collateralVault():(address)"],
    ["hashrateOracle", "hashrateOracle():(address)"],
    ["minimumPriceIncrement", "minimumPriceIncrement():(uint256)"],
    ["makerFee", "makerFee():(uint256)"],
    ["takerFee", "takerFee():(uint256)"],
    ["liquidationFee", "liquidationFee():(uint256)"],
    ["marginEngine", "marginEngine():(address)"],
    ["liquidationMarginPercent", "liquidationMarginPercent():(uint8)"],
    ["CONTRACT_SIZE_HPS_DAY", "CONTRACT_SIZE_HPS_DAY():(uint256)"],
    ["expirationIntervalDays", "expirationIntervalDays():(uint8)"],
    ["futureDeliveryDatesCount", "futureDeliveryDatesCount():(uint8)"],
    ["firstFutureDeliveryDate", "firstFutureDeliveryDate():(uint256)"],
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
  f.collateralToken = Bytes.empty();
  f.hashrateOracleAddress = Bytes.empty();
  f.marginEngineAddress = Bytes.empty();
  f.startBlock = BigInt.zero();
  f.minimumPriceIncrement = BigInt.zero();
  f.makerFee = BigInt.zero();
  f.takerFee = BigInt.zero();
  f.liquidationFee = BigInt.zero();
  f.liquidationMarginPercent = 0;
  f.contractSizeHpsDay = BigInt.zero();
  f.expirationIntervalDays = 0;
  f.futureDeliveryDatesCount = 0;
  f.firstFutureDeliveryDate = BigInt.zero();
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

/// Like `fillAggKeyDefaultTx` but with a custom tx hash (set via `nudgeTx`).
/// `sessionId` matches the deterministic PositionSession id (see `positionSessionId`).
export function fillAggKey(
  txHashBytes: Bytes,
  user: Address,
  counterparty: Address,
  sessionId: string,
): string {
  return txHashBytes
    .concat(ID_SEP)
    .concat(changetype<Bytes>(user))
    .concat(ID_SEP)
    .concat(changetype<Bytes>(counterparty))
    .concat(ID_SEP)
    .concat(Bytes.fromUTF8(sessionId))
    .toHexString();
}

/// Tx hash that matches the `nudgeTx` helper above for predictable reads.
export function nudgedTxHash(seed: i32): Bytes {
  const hex = padLeft(seed.toString(16), 40, "0");
  return Bytes.fromHexString("0x" + hex) as Bytes;
}

/// Event id used by Liquidation / BadDebtEvent: txHash.concatI32(logIndex).
/// Default matchstick logIndex is 1.
export function eventIdHex(logIndex: i32 = 1): string {
  return MOCK_TX_HASH.concatI32(logIndex).toHexString();
}

/// Order aggregate id: tx hash ++ user ++ price (32B) ++ deliveryAt (32B) ++ side (1B).
/// Mirrors `src/ids.ts#orderAggregateId` so tests can predict it.
export function orderAggKeyDefaultTx(
  user: Address,
  price: BigInt,
  deliveryAt: BigInt,
  isBuy: boolean,
): string {
  const priceBytes = Bytes.fromHexString("0x" + bigIntHex32(price)) as Bytes;
  const deliveryBytes = Bytes.fromHexString("0x" + bigIntHex32(deliveryAt)) as Bytes;
  const sideBytes = Bytes.fromHexString(isBuy ? "0x01" : "0x00") as Bytes;
  return MOCK_TX_HASH.concat(changetype<Bytes>(user))
    .concat(priceBytes)
    .concat(deliveryBytes)
    .concat(sideBytes)
    .toHexString();
}

/// Trade aggregate id: tx hash ++ sep ++ user ++ sep ++ sessionId.
export function tradeAggKeyDefaultTx(user: Address, sessionId: string): string {
  return MOCK_TX_HASH.concat(ID_SEP)
    .concat(changetype<Bytes>(user))
    .concat(ID_SEP)
    .concat(Bytes.fromUTF8(sessionId))
    .toHexString();
}

/// Fill aggregate id: tx hash ++ sep ++ user ++ sep ++ counterparty ++ sep ++ sessionId.
export function fillAggKeyDefaultTx(
  user: Address,
  counterparty: Address,
  sessionId: string,
): string {
  return MOCK_TX_HASH.concat(ID_SEP)
    .concat(changetype<Bytes>(user))
    .concat(ID_SEP)
    .concat(changetype<Bytes>(counterparty))
    .concat(ID_SEP)
    .concat(Bytes.fromUTF8(sessionId))
    .toHexString();
}
