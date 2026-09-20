/**
 * Integration test: backward-compatible `expiration` relation.
 *
 * Every entity carrying a `expirationAt` (Order, PriceLevel, PositionSession,
 * Trade) also gets a nullable `expiration` relation pointing at the shared
 * `FuturesExpiration` row for that expiration date. This test asserts the relation
 * is wired on each entity, that the original `expirationAt` scalar is untouched,
 * and that an unsettled expiration has a null `settlementPrice`.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { futuresExpirationId, priceLevelId } from "./helpers.ts";
import { TimeInForce } from "../../contracts/tests/timeInForce.ts";

const conn = await network.getOrCreate();

function isNullish(value: unknown): boolean {
  return value == null || String(value) === "";
}

describe("FuturesExpiration relation wiring", () => {
  after(() => conn.matchstick.reset());

  it("wires `expiration` onto Order, PriceLevel, PositionSession and Trade", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const entry = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("HashPowerFutures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Seller rests an ask (Order + PriceLevel + FuturesExpiration), buyer crosses it
    // (PositionSession + Trade).
    const askTx = await futures.write.createOrder([entry, deliveryDate, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await pc.waitForTransactionReceipt({ hash: askTx });

    const buyTx = await futures.write.createOrder([entry, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [orderMatched] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.ok(orderMatched);

    const expId = futuresExpirationId(deliveryDate);
    const askLevelId = priceLevelId(deliveryDate, entry, false);

    const snap = await conn.matchstick.indexSnapshot([
      read("FuturesExpiration", expId),
      read("PriceLevel", askLevelId),
    ]);

    // FuturesExpiration exists, is keyed by the timestamp, and is unsettled (null price).
    const exp = snap.entity("FuturesExpiration", expId);
    assert.ok(exp, "FuturesExpiration must be lazily created on first use");
    assert.equal(String(exp.expirationAt), deliveryDate.toString());
    assert.ok(isNullish(exp.settlementPrice), "unsettled expiration has null settlementPrice");

    // PriceLevel: relation set + expirationAt scalar untouched.
    const level = snap.entity("PriceLevel", askLevelId);
    assert.ok(level, "PriceLevel must exist");
    assert.equal(String(level.expiration).toLowerCase(), expId, "PriceLevel.expiration -> FuturesExpiration");
    assert.equal(String(level.expirationAt), deliveryDate.toString(), "PriceLevel.expirationAt scalar untouched");

    // Order: every indexed aggregate carries the relation + untouched scalar.
    const orders = snap.saved("Order");
    assert.ok(orders.length > 0, "at least one Order indexed");
    for (const o of orders) {
      assert.equal(String(o.expiration).toLowerCase(), expId, "Order.expiration -> FuturesExpiration");
      assert.equal(String(o.expirationAt), deliveryDate.toString(), "Order.expirationAt scalar untouched");
    }

    // PositionSession + Trade: every indexed row carries the relation.
    const sessions = snap.saved("PositionSession");
    assert.ok(sessions.length > 0, "at least one PositionSession indexed");
    for (const s of sessions) {
      assert.equal(String(s.expiration).toLowerCase(), expId, "PositionSession.expiration -> FuturesExpiration");
      assert.equal(String(s.expirationAt), deliveryDate.toString(), "PositionSession.expirationAt scalar untouched");
    }

    const trades = snap.saved("Trade");
    assert.ok(trades.length > 0, "at least one Trade indexed");
    for (const t of trades) {
      assert.equal(String(t.expiration).toLowerCase(), expId, "Trade.expiration -> FuturesExpiration");
      assert.equal(String(t.expirationAt), deliveryDate.toString(), "Trade.expirationAt scalar untouched");
    }
  });
});
