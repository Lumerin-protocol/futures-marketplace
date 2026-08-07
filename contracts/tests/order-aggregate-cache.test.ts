import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseUnits } from "viem";
import type { Address } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";
import { refreshHashprice, scaleHashprice } from "./utils.ts";

const { networkHelpers } = await network.getOrCreate();

type FuturesContract = Awaited<ReturnType<typeof deployFuturesFixture>>["contracts"]["futures"];
type OrderAggregate = {
  readonly buyQty: bigint;
  readonly sellQty: bigint;
  readonly buyValue: bigint;
  readonly sellValue: bigint;
};

function aggregateTuple(
  aggregate: OrderAggregate,
): [buyQty: bigint, sellQty: bigint, buyValue: bigint, sellValue: bigint] {
  return [aggregate.buyQty, aggregate.sellQty, aggregate.buyValue, aggregate.sellValue];
}

async function assertCacheMatchesOrders(
  futures: FuturesContract,
  user: Address,
  expirationAts: readonly bigint[],
) {
  const expected = new Map<bigint, [bigint, bigint, bigint, bigint]>();
  for (const expirationAt of expirationAts) expected.set(expirationAt, [0n, 0n, 0n, 0n]);

  for (const orderId of await futures.read.getUserOrders([user])) {
    const order = await futures.read.getOrder([orderId]);
    const aggregate = expected.get(order.expirationAt) ?? [0n, 0n, 0n, 0n];
    const absQty = order.quantity > 0n ? order.quantity : -order.quantity;
    if (order.quantity > 0n) {
      aggregate[0] += absQty;
      aggregate[2] += order.price * absQty;
    } else {
      aggregate[1] += absQty;
      aggregate[3] += order.price * absQty;
    }
    expected.set(order.expirationAt, aggregate);
  }

  for (const expirationAt of expirationAts) {
    assert.deepEqual(
      aggregateTuple(await futures.read.getOrderAggregateAtExpiration([user, expirationAt])),
      expected.get(expirationAt),
      `cache mismatch at expiration ${expirationAt}`,
    );
  }
}

describe("Futures per-expiration order aggregate cache", () => {
  it("tracks mixed sides across expirations through reduce, cancel, update, and rollback", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;
    const expirationAts = config.deliveryDates.slice(0, 3);
    const buyPrice = parseUnits("30", 6);
    const sellPrice = parseUnits("40", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await futures.write.createOrders(
      [
        expirationAts.flatMap((expirationAt, i) => [
          {
            price: buyPrice + BigInt(i) * config.priceLadderStep,
            expirationAt,
            quantity: BigInt(i + 2),
            timeInForce: TimeInForce.GTC,
          },
          {
            price: sellPrice + BigInt(i) * config.priceLadderStep,
            expirationAt,
            quantity: -BigInt(i + 3),
            timeInForce: TimeInForce.GTC,
          },
        ]),
      ],
      { account: seller.account },
    );
    await assertCacheMatchesOrders(futures, seller.account.address, expirationAts);

    const ids = await futures.read.getUserOrders([seller.account.address]);
    const reduced = await futures.read.getOrder([ids[0]]);
    const reducedQty = reduced.quantity > 0n ? 1n : -1n;
    await futures.write.updateOrders(
      [
        [ids[1]],
        [{ orderId: ids[0], newQuantity: reducedQty }],
        [
          {
            price: buyPrice,
            expirationAt: expirationAts[2],
            quantity: 5n,
            timeInForce: TimeInForce.GTC,
          },
        ],
      ],
      { account: seller.account },
    );
    await assertCacheMatchesOrders(futures, seller.account.address, expirationAts);

    const beforeIds = await futures.read.getUserOrders([seller.account.address]);
    const beforeAggregates = await Promise.all(
      expirationAts.map((expirationAt) =>
        futures.read.getOrderAggregateAtExpiration([seller.account.address, expirationAt]),
      ),
    );
    await assert.rejects(
      futures.write.updateOrders(
        [
          [beforeIds[0]],
          [],
          [
            {
              price: 1n,
              expirationAt: expirationAts[0],
              quantity: 1n,
              timeInForce: TimeInForce.GTC,
            },
          ],
        ],
        { account: seller.account },
      ),
      /InvalidPrice/,
    );
    assert.deepEqual(await futures.read.getUserOrders([seller.account.address]), beforeIds);
    for (let i = 0; i < expirationAts.length; i++) {
      assert.deepEqual(
        await futures.read.getOrderAggregateAtExpiration([
          seller.account.address,
          expirationAts[i],
        ]),
        beforeAggregates[i],
      );
    }

    await assertCacheMatchesOrders(futures, seller.account.address, expirationAts);
  });

  it("tracks normal fills, self-crosses at maker price, and GTC remainders at taker limit", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;
    const expirationAt = config.deliveryDates[0];
    const makerPrice = parseUnits("40", 6);
    const takerLimit = parseUnits("50", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([makerPrice, expirationAt, -10n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([makerPrice, expirationAt, 4n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await assertCacheMatchesOrders(futures, seller.account.address, [expirationAt]);
    assert.deepEqual(
      aggregateTuple(
        await futures.read.getOrderAggregateAtExpiration([seller.account.address, expirationAt]),
      ),
      [0n, 6n, 0n, makerPrice * 6n],
    );

    await futures.write.createOrder([makerPrice, expirationAt, 6n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await assertCacheMatchesOrders(futures, seller.account.address, [expirationAt]);

    await futures.write.createOrder([makerPrice, expirationAt, -5n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await futures.write.createOrder([takerLimit, expirationAt, 2n, TimeInForce.GTC], {
      account: buyer.account,
    });
    assert.deepEqual(
      aggregateTuple(
        await futures.read.getOrderAggregateAtExpiration([buyer.account.address, expirationAt]),
      ),
      [0n, 3n, 0n, makerPrice * 3n],
    );

    await futures.write.createOrder([takerLimit, expirationAt, 5n, TimeInForce.GTC], {
      account: buyer.account,
    });
    assert.deepEqual(
      aggregateTuple(
        await futures.read.getOrderAggregateAtExpiration([buyer.account.address, expirationAt]),
      ),
      [2n, 0n, takerLimit * 2n, 0n],
      "self-cross remainder must be cached at the taker limit",
    );
    await assertCacheMatchesOrders(futures, buyer.account.address, [expirationAt]);

    const secondExpirationAt = config.deliveryDates[1];
    await futures.write.createOrder([makerPrice, secondExpirationAt, -2n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([takerLimit, secondExpirationAt, 5n, TimeInForce.GTC], {
      account: buyer.account,
    });
    assert.deepEqual(
      aggregateTuple(
        await futures.read.getOrderAggregateAtExpiration([
          buyer.account.address,
          secondExpirationAt,
        ]),
      ),
      [3n, 0n, takerLimit * 3n, 0n],
      "normal-fill remainder must be cached at the taker limit",
    );
    await assertCacheMatchesOrders(futures, buyer.account.address, [expirationAt, secondExpirationAt]);
  });

  it("keeps expired physical orders raw until removal and clears caches on reset", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { owner, seller, buyer, tc } = accounts;
    const [expiredAt, laterAt] = config.deliveryDates;
    const price = parseUnits("40", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await futures.write.createOrder([price, expiredAt, -2n, TimeInForce.GTC], {
      account: seller.account,
    });
    const [expiredOrderId] = await futures.read.getUserOrders([seller.account.address]);

    await tc.setNextBlockTimestamp({ timestamp: expiredAt + 1n });
    await tc.mine({ blocks: 1 });
    await refreshHashprice(hashpriceUsd, expiredAt + 1n);

    assert.deepEqual(
      aggregateTuple(
        await futures.read.getOrderAggregateAtExpiration([seller.account.address, expiredAt]),
      ),
      [0n, 2n, 0n, price * 2n],
      "raw cache includes expired physical orders",
    );
    await futures.write.removeOutdatedOrders([[expiredOrderId]], { account: buyer.account });
    assert.deepEqual(
      aggregateTuple(
        await futures.read.getOrderAggregateAtExpiration([seller.account.address, expiredAt]),
      ),
      [0n, 0n, 0n, 0n],
    );

    await futures.write.createOrder([price, laterAt, 3n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.resetState([[seller.account.address]], { account: owner.account });
    assert.equal((await futures.read.getUserOrders([seller.account.address])).length, 0);
    assert.deepEqual(
      aggregateTuple(
        await futures.read.getOrderAggregateAtExpiration([seller.account.address, laterAt]),
      ),
      [0n, 0n, 0n, 0n],
    );
  });

  it("removes the cached order aggregate during order liquidation", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { buyer, buyer2 } = accounts;
    const expirationAt = config.deliveryDates[0];
    const price = await futures.read.getMarketPrice();

    await collateralVault.write.deposit([(price * 21n) / 100n], { account: buyer.account });
    await futures.write.createOrder([price, expirationAt, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const [orderId] = await futures.read.getUserOrders([buyer.account.address]);
    await scaleHashprice(hashpriceUsd, 1n, 20n);
    assert.equal(await futures.read.isLiquidatable([buyer.account.address]), true);

    await futures.write.liquidateOrder([buyer.account.address, orderId], {
      account: buyer2.account,
    });
    assert.deepEqual(
      aggregateTuple(
        await futures.read.getOrderAggregateAtExpiration([buyer.account.address, expirationAt]),
      ),
      [0n, 0n, 0n, 0n],
    );
  });

  it("matches scan-based risk values with one global clamp per side", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;
    const mark = await futures.read.getMarketPrice();
    const unit = parseUnits("1", 6);
    const expirationAts = config.deliveryDates.slice(0, 4);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await futures.write.createOrders(
      [
        [
          {
            price: mark + 10n * unit,
            expirationAt: expirationAts[0],
            quantity: 1n,
            timeInForce: TimeInForce.GTC,
          },
          {
            price: mark - 9n * unit,
            expirationAt: expirationAts[1],
            quantity: 1n,
            timeInForce: TimeInForce.GTC,
          },
          {
            price: mark - 10n * unit,
            expirationAt: expirationAts[2],
            quantity: -1n,
            timeInForce: TimeInForce.GTC,
          },
          {
            price: mark + 9n * unit,
            expirationAt: expirationAts[3],
            quantity: -1n,
            timeInForce: TimeInForce.GTC,
          },
        ],
      ],
      { account: seller.account },
    );

    const risk = await futures.read.getRiskView([seller.account.address]);
    assert.equal(risk.buyOrderDelta, 2n * unit);
    assert.equal(risk.sellOrderDelta, 2n * unit);
    assert.equal(risk.buyOrderFillLoss, unit);
    assert.equal(risk.sellOrderFillLoss, unit);
    assert.deepEqual(await futures.read.getOrderAggregate([seller.account.address]), {
      buyQty: 2n,
      sellQty: 2n,
      buyValue: 2n * mark + unit,
      sellValue: 2n * mark - unit,
    });
    await assertCacheMatchesOrders(futures, seller.account.address, expirationAts);
  });

  it("includes expirationAt == block.timestamp, then excludes but retains raw expired orders", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { seller, tc } = accounts;
    const expirationAt = config.deliveryDates[0];
    const mark = await futures.read.getMarketPrice();
    const price = mark + parseUnits("1", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await futures.write.createOrder([price, expirationAt, 2n, TimeInForce.GTC], {
      account: seller.account,
    });
    await refreshHashprice(hashpriceUsd, expirationAt);
    await tc.setNextBlockTimestamp({ timestamp: expirationAt });
    await tc.mine({ blocks: 1 });

    const atBoundary = await futures.read.getRiskView([seller.account.address]);
    assert.equal(atBoundary.buyOrderDelta, 2n * parseUnits("1", 6));
    assert.equal(atBoundary.buyOrderFillLoss, (price - mark) * 2n);
    assert.deepEqual(await futures.read.getOrderAggregate([seller.account.address]), {
      buyQty: 2n,
      sellQty: 0n,
      buyValue: price * 2n,
      sellValue: 0n,
    });

    const staleExpiredAt = expirationAt + (await futures.read.MAX_ORACLE_STALENESS()) + 2n;
    await tc.setNextBlockTimestamp({ timestamp: staleExpiredAt });
    await tc.mine({ blocks: 1 });
    const afterBoundary = await futures.read.getRiskView([seller.account.address]);
    assert.equal(afterBoundary.buyOrderDelta, 0n);
    assert.equal(afterBoundary.buyOrderFillLoss, 0n);
    assert.deepEqual(await futures.read.getOrderAggregate([seller.account.address]), {
      buyQty: 0n,
      sellQty: 0n,
      buyValue: 0n,
      sellValue: 0n,
    });
    assert.deepEqual(
      aggregateTuple(
        await futures.read.getOrderAggregateAtExpiration([seller.account.address, expirationAt]),
      ),
      [2n, 0n, price * 2n, 0n],
    );
  });

  it("uses a pinned settlement mark at the exact boundary and preserves live stale-oracle reverts", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { seller, tc } = accounts;
    const expirationAt = config.deliveryDates[0];
    const mark = await futures.read.getMarketPrice();
    const price = mark + parseUnits("1", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await futures.write.createOrder([price, expirationAt, 1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await refreshHashprice(hashpriceUsd, expirationAt);
    await tc.setNextBlockTimestamp({ timestamp: expirationAt });
    await futures.write.recordSettlementPrice([expirationAt], { account: seller.account });

    const settledRisk = await futures.read.getRiskView([seller.account.address]);
    assert.equal(settledRisk.buyOrderDelta, parseUnits("1", 6));
    assert.equal(settledRisk.buyOrderFillLoss, price - mark);

    const { contracts: liveContracts, accounts: liveAccounts, config: liveConfig } =
      await networkHelpers.loadFixture(deployFuturesFixture);
    const liveExpirationAt = liveConfig.deliveryDates[1];
    const liveMark = await liveContracts.futures.read.getMarketPrice();
    await liveContracts.collateralVault.write.deposit([parseUnits("10000", 6)], {
      account: liveAccounts.seller.account,
    });
    await liveContracts.futures.write.createOrder(
      [liveMark, liveExpirationAt, 1n, TimeInForce.GTC],
      { account: liveAccounts.seller.account },
    );
    const [roundId, answer, startedAt, , answeredInRound] =
      await liveContracts.hashpriceUsd.read.latestRoundData();
    const latest = await liveAccounts.pc.getBlock({ blockTag: "latest" });
    await liveContracts.hashpriceUsd.write.setRound(
      [
        roundId,
        answer,
        startedAt,
        latest.timestamp - (await liveContracts.futures.read.MAX_ORACLE_STALENESS()) - 1n,
        answeredInRound,
      ],
      { account: liveAccounts.owner.account.address, chain: liveAccounts.owner.chain },
    );
    await assert.rejects(
      liveContracts.futures.read.getRiskView([liveAccounts.seller.account.address]),
      /OracleStale/,
    );
  });
});
