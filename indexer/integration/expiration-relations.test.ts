/**
 * Integration test: backward-compatible `expiration` relation.
 *
 * Every entity carrying a `deliveryAt` (Order, PriceLevel, Lot, PositionSession,
 * Trade) also gets a nullable `expiration` relation pointing at the shared
 * `FuturesExpiration` row for that delivery date. This test asserts the relation
 * is wired on each entity, that the original `deliveryAt` scalar is untouched,
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

const conn = await network.getOrCreate();

function isNullish(value: unknown): boolean {
  return value == null || String(value) === "";
}

describe("FuturesExpiration relation wiring", () => {
  after(() => conn.matchstick.reset());

  it("wires `expiration` onto Order, PriceLevel, Lot, PositionSession and Trade", async () => {
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

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Seller rests an ask (Order + PriceLevel + FuturesExpiration), buyer crosses it
    // (Lot + PositionSession + Trade).
    const askTx = await futures.write.createOrder([entry, deliveryDate, "", -1], {
      account: seller.account,
    });
    await pc.waitForTransactionReceipt({ hash: askTx });

    const buyTx = await futures.write.createOrder([entry, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [lotCreated] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });

    const expId = futuresExpirationId(deliveryDate);
    const askLevelId = priceLevelId(deliveryDate, entry, false);

    const snap = await conn.matchstick.indexSnapshot([
      read("FuturesExpiration", expId),
      read("PriceLevel", askLevelId),
      read("Lot", lotCreated.args.lotId),
    ]);

    // FuturesExpiration exists, is keyed by the timestamp, and is unsettled (null price).
    const exp = snap.entity("FuturesExpiration", expId);
    assert.ok(exp, "FuturesExpiration must be lazily created on first use");
    assert.equal(String(exp.deliveryAt), deliveryDate.toString());
    assert.ok(isNullish(exp.settlementPrice), "unsettled expiration has null settlementPrice");

    // PriceLevel: relation set + deliveryAt scalar untouched.
    const level = snap.entity("PriceLevel", askLevelId);
    assert.ok(level, "PriceLevel must exist");
    assert.equal(String(level.expiration).toLowerCase(), expId, "PriceLevel.expiration -> FuturesExpiration");
    assert.equal(String(level.deliveryAt), deliveryDate.toString(), "PriceLevel.deliveryAt scalar untouched");

    // Lot: relation set + deliveryAt scalar untouched.
    const lot = snap.entity("Lot", lotCreated.args.lotId);
    assert.ok(lot, "Lot must exist");
    assert.equal(String(lot.expiration).toLowerCase(), expId, "Lot.expiration -> FuturesExpiration");
    assert.equal(String(lot.deliveryAt), deliveryDate.toString(), "Lot.deliveryAt scalar untouched");

    // Order: every indexed aggregate carries the relation + untouched scalar.
    const orders = snap.saved("Order");
    assert.ok(orders.length > 0, "at least one Order indexed");
    for (const o of orders) {
      assert.equal(String(o.expiration).toLowerCase(), expId, "Order.expiration -> FuturesExpiration");
      assert.equal(String(o.deliveryAt), deliveryDate.toString(), "Order.deliveryAt scalar untouched");
    }

    // PositionSession + Trade: every indexed row carries the relation.
    const sessions = snap.saved("PositionSession");
    assert.ok(sessions.length > 0, "at least one PositionSession indexed");
    for (const s of sessions) {
      assert.equal(String(s.expiration).toLowerCase(), expId, "PositionSession.expiration -> FuturesExpiration");
      assert.equal(String(s.deliveryAt), deliveryDate.toString(), "PositionSession.deliveryAt scalar untouched");
    }

    const trades = snap.saved("Trade");
    assert.ok(trades.length > 0, "at least one Trade indexed");
    for (const t of trades) {
      assert.equal(String(t.expiration).toLowerCase(), expId, "Trade.expiration -> FuturesExpiration");
      assert.equal(String(t.deliveryAt), deliveryDate.toString(), "Trade.deliveryAt scalar untouched");
    }
  });
});
