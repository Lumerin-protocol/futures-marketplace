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

/// (user, deliveryAt) pointer id: 20-byte address ++ 4-byte i32 deliveryAt.
export function pointerKey(user: Address, deliveryAt: BigInt): string {
  return changetype<Bytes>(user).concatI32(deliveryAt.toI32()).toHexString();
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
    ["validatorAddress", "validatorAddress():(address)"],
    ["validatorURL", "validatorURL():(string)"],
    ["minimumPriceIncrement", "minimumPriceIncrement():(uint256)"],
    ["makerFee", "makerFee():(uint256)"],
    ["takerFee", "takerFee():(uint256)"],
    ["liquidationMarginPercent", "liquidationMarginPercent():(uint8)"],
    ["speedHps", "speedHps():(uint256)"],
    ["deliveryDurationDays", "deliveryDurationDays():(uint8)"],
    ["deliveryIntervalDays", "deliveryIntervalDays():(uint8)"],
    ["futureDeliveryDatesCount", "futureDeliveryDatesCount():(uint8)"],
    ["firstFutureDeliveryDate", "firstFutureDeliveryDate():(uint256)"],
    ["breachPenaltyRatePerDay", "breachPenaltyRatePerDay():(uint256)"],
    ["collectedFeesBalance", "collectedFeesBalance():(uint256)"],
  ];
  for (let i = 0; i < getters.length; i++) {
    createMockedFunction(addr, getters[i][0], getters[i][1]).reverts();
  }
}

/// Pre-create the Futures singleton so handlers don't try to call into the
/// (unmocked) on-chain contract during tests. Default `deliveryDurationDays`
/// is 30 because exit-pnl arithmetic divides by it.
export function setupFutures(deliveryDurationDays: i32 = 30): void {
  const f = new Futures(0);
  f.contractAddress = changetype<Bytes>(contractAddress());
  f.collateralToken = Bytes.empty();
  f.hashrateOracleAddress = Bytes.empty();
  f.validatorAddress = Bytes.empty();
  f.validatorURL = "";
  f.startBlock = BigInt.zero();
  f.minimumPriceIncrement = BigInt.zero();
  f.makerFee = BigInt.zero();
  f.takerFee = BigInt.zero();
  f.liquidationMarginPercent = 0;
  f.speedHps = BigInt.zero();
  f.deliveryDurationDays = deliveryDurationDays;
  f.deliveryIntervalDays = 0;
  f.futureDeliveryDatesCount = 0;
  f.firstFutureDeliveryDate = BigInt.zero();
  f.breachPenaltyRatePerDay = BigInt.zero();
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

/// Like `fillAggKeyDefaultTx` but with a custom tx hash (set via `nudgeTx`).
/// `sessionId` matches the deterministic PositionSession id (see `positionSessionId`).
export function fillAggKey(
  txHashBytes: Bytes,
  user: Address,
  counterparty: Address,
  sessionId: string,
): string {
  return txHashBytes
    .concat(changetype<Bytes>(user))
    .concat(changetype<Bytes>(counterparty))
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

/// Order aggregate id: tx hash ++ user ++ price (32B) ++ deliveryAt (4B i32) ++ side (4B i32).
/// Mirrors `src/ids.ts#orderAggregateId` so tests can predict it.
export function orderAggKeyDefaultTx(
  user: Address,
  price: BigInt,
  deliveryAt: BigInt,
  isBuy: boolean,
): string {
  const priceHex = padLeft(price.toHexString().slice(2), 64, "0");
  const priceBytes = Bytes.fromHexString("0x" + priceHex) as Bytes;
  return MOCK_TX_HASH.concat(changetype<Bytes>(user))
    .concat(priceBytes)
    .concatI32(deliveryAt.toI32())
    .concatI32(isBuy ? 1 : 0)
    .toHexString();
}

/// Trade aggregate id: tx hash ++ user ++ sessionId.
export function tradeAggKeyDefaultTx(user: Address, sessionId: string): string {
  return MOCK_TX_HASH.concat(changetype<Bytes>(user))
    .concat(Bytes.fromUTF8(sessionId))
    .toHexString();
}

/// Fill aggregate id: tx hash ++ user ++ counterparty ++ sessionId.
export function fillAggKeyDefaultTx(
  user: Address,
  counterparty: Address,
  sessionId: string,
): string {
  return MOCK_TX_HASH.concat(changetype<Bytes>(user))
    .concat(changetype<Bytes>(counterparty))
    .concat(Bytes.fromUTF8(sessionId))
    .toHexString();
}
