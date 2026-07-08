import { Address, BigInt, Bytes, dataSource } from "@graphprotocol/graph-ts";
import { Futures as FuturesContract } from "../../generated/Futures/Futures";
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
    futures.collateralToken = Bytes.empty();
    futures.hashrateOracleAddress = Bytes.empty();
    futures.marginEngineAddress = Bytes.empty();
    futures.startBlock = readStartBlockFromContext();
    futures.minimumPriceIncrement = BigInt.zero();
    futures.makerFee = BigInt.zero();
    futures.takerFee = BigInt.zero();
    futures.liquidationFee = BigInt.zero();
    futures.liquidationMarginPercent = 0;
    futures.contractSizeHpsDay = BigInt.zero();
    futures.expirationIntervalDays = 0;
    futures.futureDeliveryDatesCount = 0;
    futures.firstFutureDeliveryDate = BigInt.zero();
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

  const minPx = contract.try_minimumPriceIncrement();
  if (!minPx.reverted) futures.minimumPriceIncrement = minPx.value;

  const makerFee = contract.try_makerFee();
  if (!makerFee.reverted) futures.makerFee = makerFee.value;

  const takerFee = contract.try_takerFee();
  if (!takerFee.reverted) futures.takerFee = takerFee.value;

  const liquidationFee = contract.try_liquidationFee();
  if (!liquidationFee.reverted) futures.liquidationFee = liquidationFee.value;

  const marginEngine = contract.try_marginEngine();
  if (!marginEngine.reverted) futures.marginEngineAddress = marginEngine.value;

  const liqMargin = contract.try_liquidationMarginPercent();
  if (!liqMargin.reverted) futures.liquidationMarginPercent = liqMargin.value;

  const contractSizeHpsDay = contract.try_CONTRACT_SIZE_HPS_DAY();
  if (!contractSizeHpsDay.reverted) futures.contractSizeHpsDay = contractSizeHpsDay.value;

  const deliveryInterval = contract.try_expirationIntervalDays();
  if (!deliveryInterval.reverted) futures.expirationIntervalDays = deliveryInterval.value;

  const futureCount = contract.try_futureDeliveryDatesCount();
  if (!futureCount.reverted) futures.futureDeliveryDatesCount = futureCount.value;

  const firstDelivery = contract.try_firstFutureDeliveryDate();
  if (!firstDelivery.reverted) futures.firstFutureDeliveryDate = firstDelivery.value;

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

    // Deferred Futures-singleton write: the totalUsers bump is queued into a
    // module-level delta and flushed by `flushFuturesCounters` alongside other
    // per-handler `Futures` updates, keeping the singleton at one save per
    // handler invocation.
    recordNewUser();
  }
  return user;
}

/// One row per expiration timestamp, created lazily the first time any entity at that
/// `deliveryAt` is indexed. Settlement fields stay null until `SettlementPriceRecorded`
/// pins the price. Returns the (saved) entity so callers can wire the `expiration` relation.
export function getOrCreateFuturesExpiration(deliveryAt: BigInt): FuturesExpiration {
  const id = futuresExpirationId(deliveryAt);
  let expiration = FuturesExpiration.load(id);
  if (!expiration) {
    expiration = new FuturesExpiration(id);
    expiration.deliveryAt = deliveryAt;
    expiration.save();
  }
  return expiration;
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
    level.expiration = getOrCreateFuturesExpiration(deliveryAt).id;
    level.price = price;
    level.isBid = isBid;
    level.totalQuantity = 0;
  }
  return level;
}

/// Idempotent per-tx marker used by `handleOrderLiquidated` / `handleLotLiquidated`
/// to bump `Futures.totalLiquidations` exactly once per tx. Returns true iff this
/// invocation created the marker (i.e. it's the first leg seen in this tx); subsequent
/// legs in the same tx return false and the caller skips the counter increment.
export function markLiquidationTx(txHash: Bytes): boolean {
  if (LiquidationTx.load(txHash) != null) return false;
  const marker = new LiquidationTx(txHash);
  marker.save();
  return true;
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
    pointer.lastClosedSessionId = "";
  }
  return pointer;
}
