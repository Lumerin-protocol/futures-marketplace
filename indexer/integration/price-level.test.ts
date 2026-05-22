/**
 * Integration test: `PriceLevel` order-book aggregation.
 *
 * `order-lifecycle.test.ts` covers the per-price increment / decrement
 * bookkeeping on the ask side. This file pins down the orthogonal
 * dimension — bid vs ask at the **same** price live as two **separate**
 * `PriceLevel` entities (the id is `{deliveryAt}-{price}-{bid|ask}`).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { priceLevelId } from "./helpers.ts";

const conn = await network.getOrCreate();

describe("PriceLevel: bid and ask at the same price are distinct entities", () => {
  after(() => conn.matchstick.reset());

  it("keeps the resting ask and bid in two separate PriceLevel rows", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const mid = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const askPrice = mid + 3n * config.priceLadderStep;
    const bidPrice = mid - 3n * config.priceLadderStep; // < ask → no match
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Seller rests an ask, buyer rests a bid — they don't cross.
    const askTx = await futures.write.createOrder([askPrice, deliveryDate, "", -2], {
      account: seller.account,
    });
    await pc.waitForTransactionReceipt({ hash: askTx });

    const bidTx = await futures.write.createOrder([bidPrice, deliveryDate, "dst", 3], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: bidTx });

    const askId = priceLevelId(deliveryDate, askPrice, false);
    const bidId = priceLevelId(deliveryDate, bidPrice, true);

    const snap = await conn.matchstick.indexSnapshot([
      read("PriceLevel", askId),
      read("PriceLevel", bidId),
    ]);

    const ask = snap.entity("PriceLevel", askId);
    const bid = snap.entity("PriceLevel", bidId);
    assert.ok(ask, "ask PriceLevel must exist");
    assert.ok(bid, "bid PriceLevel must exist");
    assert.notEqual(ask.id, bid.id, "ask and bid must be distinct entities");

    assert.equal(String(ask.totalQuantity), "2", "ask totalQuantity is the resting qty");
    assert.equal(String(bid.totalQuantity), "3", "bid totalQuantity is the resting qty");
    assert.equal(ask.isBid, false);
    assert.equal(bid.isBid, true);

    // Field-coverage: `deliveryAt` and `price` are encoded in the composite id
    // but also persisted as scalar fields by `getOrCreatePriceLevel`; lock
    // both in directly so consumers can query without parsing the id.
    assert.equal(
      String(ask.deliveryAt),
      deliveryDate.toString(),
      "PriceLevel.deliveryAt mirrors the ask order's deliveryAt",
    );
    assert.equal(
      String(ask.price),
      askPrice.toString(),
      "PriceLevel.price mirrors the ask order's price",
    );
    assert.equal(
      String(bid.deliveryAt),
      deliveryDate.toString(),
      "PriceLevel.deliveryAt mirrors the bid order's deliveryAt",
    );
    assert.equal(
      String(bid.price),
      bidPrice.toString(),
      "PriceLevel.price mirrors the bid order's price",
    );

    // Exactly two PriceLevel rows so far — the test asserts no accidental
    // 3rd row exists (e.g. duplicate id between sides).
    const allLevels = snap.saved("PriceLevel");
    assert.equal(
      allLevels.length,
      2,
      `expected exactly one ask + one bid PriceLevel, got ${allLevels.length}`,
    );
  });
});
