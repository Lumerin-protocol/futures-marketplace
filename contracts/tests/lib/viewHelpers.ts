import type { Address, Hex } from "viem";

type FuturesReader = {
  read: {
    getExpirationDates: () => Promise<readonly bigint[]>;
    getActiveExpirationDates: (args: readonly [Address]) => Promise<readonly bigint[]>;
    getUserOrdersAtExpiration: (args: readonly [Address, bigint]) => Promise<readonly Hex[]>;
    getOrderAggregateAtExpiration: (args: readonly [Address, bigint]) => Promise<{
      buyQty: bigint;
      sellQty: bigint;
      buyValue: bigint;
      sellValue: bigint;
    }>;
    getUserPosition: (
      args: readonly [Address, bigint],
    ) => Promise<{ netQuantity: bigint; netEntryValue: bigint }>;
    settlementPrice: (args: readonly [bigint]) => Promise<bigint>;
    getOrderBookPrices: (
      args: readonly [bigint, bigint],
    ) => Promise<readonly [readonly bigint[], readonly bigint[]]>;
  };
};

/** Matches on-chain `10 ** collateralDecimals` for the six-decimal USDC deployments under test. */
const COLLATERAL_SCALE = 1_000_000n;

/** Active-window resting order ids (replaces removed `getUserOrders`). */
export async function getUserOrders(futures: FuturesReader, user: Address): Promise<Hex[]> {
  const expirationAts = await futures.read.getExpirationDates();
  const orderIds: Hex[] = [];
  for (const expirationAt of expirationAts) {
    const ids = await futures.read.getUserOrdersAtExpiration([user, expirationAt]);
    for (const id of ids) orderIds.push(id);
  }
  return orderIds;
}

/** Summed active-window order aggregate (replaces removed `getOrderAggregate`). */
export async function getOrderAggregate(futures: FuturesReader, user: Address) {
  const expirationAts = await futures.read.getExpirationDates();
  const aggregate = { buyQty: 0n, sellQty: 0n, buyValue: 0n, sellValue: 0n };
  for (const expirationAt of expirationAts) {
    const part = await futures.read.getOrderAggregateAtExpiration([user, expirationAt]);
    aggregate.buyQty += part.buyQty;
    aggregate.sellQty += part.sellQty;
    aggregate.buyValue += part.buyValue;
    aggregate.sellValue += part.sellValue;
  }
  return aggregate;
}

/**
 * Live (unpinned) position delta across active expiries, scaled like the removed
 * standalone getter. Avoids `getRiskView` so matured-but-unpriced legs still answer
 * when the oracle is stale.
 */
export async function getNetPositionDelta(futures: FuturesReader, user: Address): Promise<bigint> {
  const dates = await futures.read.getActiveExpirationDates([user]);
  let netDelta = 0n;
  for (const date of dates) {
    if ((await futures.read.settlementPrice([date])) !== 0n) continue;
    netDelta += (await futures.read.getUserPosition([user, date])).netQuantity;
  }
  return netDelta * COLLATERAL_SCALE;
}

export async function getBestBidPrice(futures: FuturesReader, expirationAt: bigint): Promise<bigint> {
  const [bids] = await futures.read.getOrderBookPrices([expirationAt, 1n]);
  return bids[0] ?? 0n;
}

export async function getBestAskPrice(futures: FuturesReader, expirationAt: bigint): Promise<bigint> {
  const [, asks] = await futures.read.getOrderBookPrices([expirationAt, 1n]);
  return asks[0] ?? 0n;
}
