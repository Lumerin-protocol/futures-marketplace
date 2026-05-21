import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { pointerId } from "./helpers.ts";

const conn = await network.getOrCreate();

describe("single match session state", () => {
  after(() => conn.matchstick.reset());

  it("creates one open lot, two per-user fills, and +/-1 netQty pointers", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    const sellTx = await futures.write.createOrder([price, deliveryDate, "", -1], {
      account: seller.account,
    });
    const sellReceipt = await pc.waitForTransactionReceipt({ hash: sellTx });
    const [makerOrderCreated] = parseEventLogs({
      logs: sellReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [lotCreated] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    assert.ok(lotCreated, "LotCreated must fire");
    const lotId = lotCreated.args.lotId.toLowerCase() as `0x${string}`;
    const makerOrderId = lotCreated.args.makerOrderId.toLowerCase() as `0x${string}`;
    const takerOrderId = lotCreated.args.takerOrderId.toLowerCase() as `0x${string}`;
    assert.equal(
      makerOrderId,
      makerOrderCreated.args.orderId.toLowerCase(),
      "LotCreated.makerOrderId must match seller's resting OrderCreated.orderId",
    );

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;
    const sellerPtrId = pointerId(seller.account.address, deliveryDate);
    const buyerPtrId = pointerId(buyer.account.address, deliveryDate);
    const snap = await conn.matchstick.indexSnapshot([
      read("Lot", lotId),
      read("UserDeliverySessionPointer", sellerPtrId),
      read("UserDeliverySessionPointer", buyerPtrId),
      read("User", sellerAddr),
      read("User", buyerAddr),
      read("Futures", "0"),
    ]);

    const lot = snap.entity("Lot", lotId);
    assert.ok(lot);
    assert.equal(lot.status, "OPEN");
    assert.equal(lot.isClosed, false);
    assert.equal(lot.sellPricePerDay, price.toString());
    assert.equal(lot.buyPricePerDay, price.toString());
    assert.equal(lot.isPaid, false);
    assert.equal(lot.isWithdrawn, false);
    assert.equal(lot.destURL, "dst", "Lot.destURL must prefer the taker's OrderEntry.destURL");
    assert.equal(lot.makerOrderId, makerOrderId, "Lot.makerOrderId must mirror the event");
    assert.equal(lot.takerOrderId, takerOrderId, "Lot.takerOrderId must mirror the event");

    assert.equal(String(snap.entity("UserDeliverySessionPointer", sellerPtrId)?.netQuantity), "-1");
    assert.equal(String(snap.entity("UserDeliverySessionPointer", buyerPtrId)?.netQuantity), "1");

    const fills = snap.saved("Fill");
    assert.equal(fills.length, 2, "per-user model: one fill for seller and one for buyer");
    const sellerFill = fills.find((f) => String(f.fillQuantity) === "-1");
    const buyerFill = fills.find((f) => String(f.fillQuantity) === "1");
    assert.ok(sellerFill);
    assert.ok(buyerFill);
    assert.equal(sellerFill.fillPrice, price.toString());
    assert.equal(buyerFill.fillPrice, price.toString());

    const trades = snap.saved("Trade");
    assert.equal(trades.length, 2, "one trade per participant");

    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(String(futuresEntity.totalFills), "2");
    assert.equal(String(futuresEntity.totalTrades), "2");

    const sellerUser = snap.entity("User", sellerAddr);
    const buyerUser = snap.entity("User", buyerAddr);
    assert.ok(sellerUser);
    assert.ok(buyerUser);
    assert.deepEqual(
      sellerUser.lots,
      [lotId],
      "seller's User.lots must contain the newly opened lot",
    );
    assert.deepEqual(buyerUser.lots, [lotId], "buyer's User.lots must contain the newly opened lot");
    assert.equal(String(sellerUser.fillCount), "1", "seller has one aggregated fill row");
    assert.equal(String(sellerUser.tradeCount), "1", "seller has one aggregated trade row");
    assert.equal(String(buyerUser.fillCount), "1");
    assert.equal(String(buyerUser.tradeCount), "1");
  });
});

describe("same tx qty=3 aggregation", () => {
  after(() => conn.matchstick.reset());

  it("aggregates fills per user into qty=-3 and qty=+3", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("1000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    await futures.write.createOrder([price, deliveryDate, "", -3], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 3], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const lots = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    assert.equal(lots.length, 3);
    const lotIds = lots.map((e) => e.args.lotId.toLowerCase() as `0x${string}`);

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;
    const sellerPtrId = pointerId(seller.account.address, deliveryDate);
    const buyerPtrId = pointerId(buyer.account.address, deliveryDate);
    const snap = await conn.matchstick.indexSnapshot([
      read("UserDeliverySessionPointer", sellerPtrId),
      read("UserDeliverySessionPointer", buyerPtrId),
      read("User", sellerAddr),
      read("User", buyerAddr),
      ...lotIds.map((id) => read("Lot", id)),
      read("Futures", "0"),
    ]);

    assert.equal(String(snap.entity("UserDeliverySessionPointer", sellerPtrId)?.netQuantity), "-3");
    assert.equal(String(snap.entity("UserDeliverySessionPointer", buyerPtrId)?.netQuantity), "3");

    const fills = snap.saved("Fill");
    assert.equal(fills.length, 2, "per-user aggregation: one fill row per side");
    const sellerFill = fills.find((f) => String(f.fillQuantity) === "-3");
    const buyerFill = fills.find((f) => String(f.fillQuantity) === "3");
    assert.ok(sellerFill);
    assert.ok(buyerFill);
    assert.equal(sellerFill.fillPrice, price.toString());
    assert.equal(buyerFill.fillPrice, price.toString());

    for (const id of lotIds) {
      assert.equal(snap.entity("Lot", id)?.destURL, "dst", `Lot ${id} must take buyer destURL`);
    }

    const sellerUser = snap.entity("User", sellerAddr);
    const buyerUser = snap.entity("User", buyerAddr);
    assert.ok(sellerUser);
    assert.ok(buyerUser);
    assert.deepEqual(
      [...(sellerUser.lots as string[])].sort(),
      [...lotIds].sort(),
      "seller's User.lots must include every lot opened in the aggregated tx",
    );
    assert.deepEqual(
      [...(buyerUser.lots as string[])].sort(),
      [...lotIds].sort(),
      "buyer's User.lots must include every lot opened in the aggregated tx",
    );
    assert.equal(
      String(sellerUser.fillCount),
      "1",
      "qty=3 aggregates to a single Fill per user, so fillCount must remain 1",
    );
    assert.equal(String(sellerUser.tradeCount), "1");
    assert.equal(String(buyerUser.fillCount), "1");
    assert.equal(String(buyerUser.tradeCount), "1");

    const futuresEntity = snap.entity("Futures", "0");
    assert.ok(futuresEntity);
    assert.equal(
      String(futuresEntity.totalFills),
      "2",
      "Futures.totalFills aggregates qty=3 into two per-user Fill rows",
    );
    assert.equal(String(futuresEntity.totalTrades), "2");
  });
});
