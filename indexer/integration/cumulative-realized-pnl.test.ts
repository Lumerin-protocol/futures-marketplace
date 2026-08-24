/**
 * matchstick-ts: Trade.cumulativeRealizedPnl is the user's lifetime realized
 * PnL after that trade, including this trade. Opens snapshot the prior total.
 * Two expirations share one User running total (they are listings, not venues).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";
import type { EntityFields } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { TimeInForce } from "../../contracts/tests/timeInForce.ts";

const conn = await network.getOrCreate();
const { matchstick } = conn;

function tradesOf(rows: EntityFields[], user: string): EntityFields[] {
  return rows
    .filter((t) => String(t.user).toLowerCase() === user)
    .sort((a, b) => {
      const ts = Number(a.timestamp) - Number(b.timestamp);
      if (ts !== 0) return ts;
      return Number(a.blockNumber) - Number(b.blockNumber);
    });
}

describe("Trade.cumulativeRealizedPnl", () => {
  after(() => matchstick.reset());

  it("snapshots 0 on open, then lifetime total across two expirations", async () => {
    const { contracts, accounts, config } =
      await conn.networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    assert.ok(
      config.deliveryDates.length >= 2,
      "fixture must list at least two expirations",
    );
    const expiryA = config.deliveryDates[0];
    const expiryB = config.deliveryDates[1];

    const p1 = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const p2 = p1 + config.priceLadderStep;
    const expectedClosePnl = p2 - p1;
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    matchstick.bind("HashPowerFutures", futures.address, futures.abi);
    await matchstick.captureViewMocks();
    await matchstick.anchor();

    const buyerAddr = buyer.account.address.toLowerCase();

    const matchAt = async (price: bigint, expiry: bigint, sellerQty: bigint) => {
      const restTx = await futures.write.createOrder(
        [price, expiry, sellerQty, TimeInForce.GTC],
        { account: seller.account },
      );
      await pc.waitForTransactionReceipt({ hash: restTx });
      const takeTx = await futures.write.createOrder(
        [price, expiry, -sellerQty, TimeInForce.GTC],
        { account: buyer.account },
      );
      await pc.waitForTransactionReceipt({ hash: takeTx });
    };

    // Expiry A: open long (sellerQty = -1 → seller short, buyer long), then close at p2.
    await matchAt(p1, expiryA, -1n);
    await matchAt(p2, expiryA, 1n);

    // Expiry B: same round trip. Lifetime total for the buyer should double.
    await matchAt(p1, expiryB, -1n);
    await matchAt(p2, expiryB, 1n);

    const snap = await matchstick.indexSnapshot([]);
    const buyerTrades = tradesOf(snap.saved("Trade"), buyerAddr);
    assert.equal(buyerTrades.length, 4, "buyer has open+close on each of two expirations");

    assert.equal(
      String(buyerTrades[0].realizedPnl),
      "0",
      "first open realizes nothing",
    );
    assert.equal(
      String(buyerTrades[0].cumulativeRealizedPnl),
      "0",
      "first open snapshots a zero lifetime total",
    );

    assert.equal(String(buyerTrades[1].realizedPnl), expectedClosePnl.toString());
    assert.equal(
      String(buyerTrades[1].cumulativeRealizedPnl),
      expectedClosePnl.toString(),
      "first close snapshots User.realizedPnl after that close",
    );

    assert.equal(String(buyerTrades[2].realizedPnl), "0");
    assert.equal(
      String(buyerTrades[2].cumulativeRealizedPnl),
      expectedClosePnl.toString(),
      "open on the second expiry snapshots the prior lifetime total",
    );

    assert.equal(String(buyerTrades[3].realizedPnl), expectedClosePnl.toString());
    assert.equal(
      String(buyerTrades[3].cumulativeRealizedPnl),
      (expectedClosePnl * 2n).toString(),
      "second close adds onto the same User running total",
    );

    const buyerUser = snap.entity("User", buyerAddr);
    assert.ok(buyerUser);
    assert.equal(
      String(buyerUser.realizedPnl),
      String(buyerTrades[3].cumulativeRealizedPnl),
      "latest Trade.cumulativeRealizedPnl equals User.realizedPnl",
    );
  });
});
