import { Address, BigInt, Bytes, dataSource } from "@graphprotocol/graph-ts";
import { Futures as FuturesContract } from "../../generated/Futures/Futures";
import { Futures, PriceLevel, User, UserDeliverySessionPointer } from "../../generated/schema";
import { priceLevelId, userDeliveryPointerId } from "../ids";

/// Singleton row keyed by `id = 0`. All contract-wide config + counters live here.
export function getOrCreateFutures(): Futures {
  let futures = Futures.load(0);
  if (!futures) {
    futures = new Futures(0);
    futures.contractAddress = dataSource.address();
    futures.collateralToken = Bytes.empty();
    futures.hashrateOracleAddress = Bytes.empty();
    futures.validatorAddress = Bytes.empty();
    futures.validatorURL = "";
    futures.startBlock = readStartBlockFromContext();
    futures.minimumPriceIncrement = BigInt.zero();
    futures.orderFee = BigInt.zero();
    futures.liquidationMarginPercent = 0;
    futures.speedHps = BigInt.zero();
    futures.deliveryDurationDays = 0;
    futures.deliveryIntervalDays = 0;
    futures.futureDeliveryDatesCount = 0;
    futures.firstFutureDeliveryDate = BigInt.zero();
    futures.breachPenaltyRatePerDay = BigInt.zero();
    futures.collectedFeesBalance = BigInt.zero();
    futures.totalUsers = 0;
    futures.totalOrders = 0;
    futures.activeOrders = 0;
    futures.totalTrades = 0;
    futures.totalFills = 0;
    futures.totalVolume = BigInt.zero();
    futures.totalLiquidations = 0;
    futures.totalBadDebt = BigInt.zero();
    futures.initializedAt = BigInt.zero();
    futures.lastUpdatedAt = BigInt.zero();
    loadFuturesFromContract(futures);
  }
  return futures;
}

/// Pull the configured start block from the data source context (set in
/// `subgraph.template.yaml` from the `START_BLOCK_FUTURES` env var).
/// Returns zero if the context entry is absent (e.g. matchstick tests).
function readStartBlockFromContext(): BigInt {
  const ctx = dataSource.context();
  const value = ctx.get("startBlock");
  if (value == null) return BigInt.zero();
  return value.toBigInt();
}

/// Refresh on-chain config snapshot via getter eth_calls. Best-effort: any
/// reverted call leaves the existing field untouched.
export function loadFuturesFromContract(futures: Futures): void {
  const contract = FuturesContract.bind(dataSource.address());

  const collateralVault = contract.try_collateralVault();
  if (!collateralVault.reverted) futures.collateralToken = collateralVault.value;

  const hashrate = contract.try_hashrateOracle();
  if (!hashrate.reverted) futures.hashrateOracleAddress = hashrate.value;

  const validator = contract.try_validatorAddress();
  if (!validator.reverted) futures.validatorAddress = validator.value;

  const validatorURL = contract.try_validatorURL();
  if (!validatorURL.reverted) futures.validatorURL = validatorURL.value;

  const minPx = contract.try_minimumPriceIncrement();
  if (!minPx.reverted) futures.minimumPriceIncrement = minPx.value;

  const orderFee = contract.try_orderFee();
  if (!orderFee.reverted) futures.orderFee = orderFee.value;

  const liqMargin = contract.try_liquidationMarginPercent();
  if (!liqMargin.reverted) futures.liquidationMarginPercent = liqMargin.value;

  const speedHps = contract.try_speedHps();
  if (!speedHps.reverted) futures.speedHps = speedHps.value;

  const deliveryDuration = contract.try_deliveryDurationDays();
  if (!deliveryDuration.reverted) futures.deliveryDurationDays = deliveryDuration.value;

  const deliveryInterval = contract.try_deliveryIntervalDays();
  if (!deliveryInterval.reverted) futures.deliveryIntervalDays = deliveryInterval.value;

  const futureCount = contract.try_futureDeliveryDatesCount();
  if (!futureCount.reverted) futures.futureDeliveryDatesCount = futureCount.value;

  const firstDelivery = contract.try_firstFutureDeliveryDate();
  if (!firstDelivery.reverted) futures.firstFutureDeliveryDate = firstDelivery.value;

  const breach = contract.try_breachPenaltyRatePerDay();
  if (!breach.reverted) futures.breachPenaltyRatePerDay = breach.value;

  const fees = contract.try_collectedFeesBalance();
  if (!fees.reverted) futures.collectedFeesBalance = fees.value;
}

export function getOrCreateUser(address: Address, timestamp: BigInt): User {
  let user = User.load(address);
  if (!user) {
    user = new User(address);
    user.address = address;
    user.orderCount = 0;
    user.activeOrderCount = 0;
    user.tradeCount = 0;
    user.fillCount = 0;
    user.realizedPnl = BigInt.zero();
    user.lots = [];
    user.createdAt = timestamp;
    user.lastActivityAt = timestamp;

    const futures = getOrCreateFutures();
    futures.totalUsers++;
    futures.save();
  }
  return user;
}

export function getOrCreatePriceLevel(
  deliveryAt: BigInt,
  price: BigInt,
  isBid: boolean,
): PriceLevel {
  const id = priceLevelId(deliveryAt, price, isBid);
  let level = PriceLevel.load(id);
  if (!level) {
    level = new PriceLevel(id);
    level.deliveryAt = deliveryAt;
    level.price = price;
    level.isBid = isBid;
    level.totalQuantity = 0;
  }
  return level;
}

/// Per-(user, deliveryAt) bookkeeping pointer: the running net qty, weighted
/// entry price, and id of the currently-OPEN PositionSession (if any).
/// Required because GraphQL has no Map<deliveryAt, …> support, so we cannot
/// derive this from User alone.
export function getOrCreatePointer(
  user: Address,
  deliveryAt: BigInt,
): UserDeliverySessionPointer {
  const id = userDeliveryPointerId(user, deliveryAt);
  let pointer = UserDeliverySessionPointer.load(id);
  if (!pointer) {
    pointer = new UserDeliverySessionPointer(id);
    pointer.user = user;
    pointer.deliveryAt = deliveryAt;
    pointer.netQuantity = 0;
    pointer.aggregatedEntryPrice = BigInt.zero();
    pointer.currentSessionId = "";
  }
  return pointer;
}
