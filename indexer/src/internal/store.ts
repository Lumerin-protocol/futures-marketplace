import { Address, BigInt, Bytes, dataSource } from "@graphprotocol/graph-ts";
import { HashPowerFutures as HashPowerFuturesContract } from "../../generated/HashPowerFutures/HashPowerFutures";
import {
  Futures,
  FuturesExpiration,
  LiquidationTx,
  PriceLevel,
  User,
  UserDeliverySessionPointer,
} from "../../generated/schema";
import { futuresExpirationId, priceLevelId, userDeliveryPointerId } from "../ids";
import { recordNewUser } from "./match";

/// Singleton row keyed by `id = 0`. All contract-wide config + counters live here.
export function getOrCreateFutures(): Futures {
  let futures = Futures.load(0);
  if (!futures) {
    futures = new Futures(0);
    futures.contractAddress = dataSource.address();
    futures.hashrateOracleAddress = Bytes.empty();
    futures.portfolioMarginAddress = Bytes.empty();
    futures.startBlock = readStartBlockFromContext();
    futures.minimumPriceIncrement = BigInt.zero();
    futures.makerFeeBps = 0;
    futures.takerFeeBps = 0;
    futures.liquidationFeeBps = 0;
    futures.liquidatorShareBps = 0;
    futures.contractSizeHpsDay = BigInt.zero();
    futures.expirationIntervalDays = 0;
    futures.futureExpirationDatesCount = 0;
    futures.firstFutureExpirationDate = BigInt.zero();
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
  const contract = HashPowerFuturesContract.bind(dataSource.address());

  const oracle = contract.try_priceOracle();
  if (!oracle.reverted) futures.hashrateOracleAddress = oracle.value;

  const minPx = contract.try_minimumPriceIncrement();
  if (!minPx.reverted) futures.minimumPriceIncrement = minPx.value;

  const makerFeeBps = contract.try_makerFeeBps();
  if (!makerFeeBps.reverted) futures.makerFeeBps = makerFeeBps.value;

  const takerFeeBps = contract.try_takerFeeBps();
  if (!takerFeeBps.reverted) futures.takerFeeBps = takerFeeBps.value;

  const liquidationFeeBps = contract.try_liquidationFeeBps();
  if (!liquidationFeeBps.reverted) futures.liquidationFeeBps = liquidationFeeBps.value;

  const liquidatorShareBps = contract.try_liquidatorShareBps();
  if (!liquidatorShareBps.reverted) futures.liquidatorShareBps = liquidatorShareBps.value;

  const portfolioMargin = contract.try_portfolioMargin();
  if (!portfolioMargin.reverted) futures.portfolioMarginAddress = portfolioMargin.value;

  const contractSizeHpsDay = contract.try_CONTRACT_SIZE_HPS_DAY();
  if (!contractSizeHpsDay.reverted) futures.contractSizeHpsDay = contractSizeHpsDay.value;

  const deliveryInterval = contract.try_expirationIntervalDays();
  if (!deliveryInterval.reverted) futures.expirationIntervalDays = deliveryInterval.value;

  const futureCount = contract.try_futureExpirationDatesCount();
  if (!futureCount.reverted) futures.futureExpirationDatesCount = futureCount.value;

  const firstDelivery = contract.try_firstFutureExpirationDate();
  if (!firstDelivery.reverted) futures.firstFutureExpirationDate = firstDelivery.value;

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
    user.lastCreatedOrderId = Bytes.empty();
    user.createdAt = timestamp;
    user.lastActivityAt = timestamp;

    // Deferred Futures-singleton write: the totalUsers bump is queued into a
    // module-level delta and flushed by `flushFuturesCounters` alongside other
    // per-handler `Futures` updates, keeping the singleton at one save per
    // handler invocation.
    recordNewUser();
  }
  return user;
}

/// One row per expiration timestamp, created lazily the first time any entity at that
/// `expirationAt` is indexed. Settlement fields stay null until `SettlementPriceRecorded`
/// pins the price. Returns the (saved) entity so callers can wire the `expiration` relation.
export function getOrCreateFuturesExpiration(expirationAt: BigInt): FuturesExpiration {
  const id = futuresExpirationId(expirationAt);
  let expiration = FuturesExpiration.load(id);
  if (!expiration) {
    expiration = new FuturesExpiration(id);
    expiration.expirationAt = expirationAt;
    expiration.save();
  }
  return expiration;
}

export function getOrCreatePriceLevel(
  expirationAt: BigInt,
  price: BigInt,
  isBid: boolean,
): PriceLevel {
  const id = priceLevelId(expirationAt, price, isBid);
  let level = PriceLevel.load(id);
  if (!level) {
    level = new PriceLevel(id);
    level.expirationAt = expirationAt;
    level.expiration = getOrCreateFuturesExpiration(expirationAt).id;
    level.price = price;
    level.isBid = isBid;
    level.totalQuantity = 0;
  }
  return level;
}

/// Idempotent per-tx marker used by `handleOrderLiquidated` / `handlePositionLiquidated`
/// to bump `Futures.totalLiquidations` exactly once per tx. Returns true iff this
/// invocation created the marker (i.e. it's the first leg seen in this tx); subsequent
/// legs in the same tx return false and the caller skips the counter increment.
export function markLiquidationTx(txHash: Bytes): boolean {
  if (LiquidationTx.load(txHash) != null) return false;
  const marker = new LiquidationTx(txHash);
  marker.save();
  return true;
}

/// Per-(user, expirationAt) bookkeeping pointer: the running net qty, weighted
/// entry price, and id of the currently-OPEN PositionSession (if any).
/// Required because GraphQL has no Map<expirationAt, …> support, so we cannot
/// derive this from User alone.
export function getOrCreatePointer(
  user: Address,
  expirationAt: BigInt,
): UserDeliverySessionPointer {
  const id = userDeliveryPointerId(user, expirationAt);
  let pointer = UserDeliverySessionPointer.load(id);
  if (!pointer) {
    pointer = new UserDeliverySessionPointer(id);
    pointer.user = user;
    pointer.expirationAt = expirationAt;
    pointer.netQuantity = 0;
    pointer.aggregatedEntryPrice = BigInt.zero();
    pointer.currentSessionId = "";
    pointer.lastClosedSessionId = "";
  }
  return pointer;
}
