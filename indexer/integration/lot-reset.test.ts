/**
 * Integration test: `resetState` admin escape hatch.
 *
 * `resetState([participants])` is the admin-only path that purges every order
 * and position for the listed participants. It emits:
 *   - `OrderClosed(orderId, participant, reason=4)` (RESET) per resting order
 *   - `LotClosed(positionId, seller, buyer, 0, 0, address(0), reason=4)` (RESET)
 *     per open position
 *
 * This is the only on-chain path that produces `OrderEntryStatus.RESET` and
 * `LotCloseReason.RESET`, so the indexer's `mapOrderEntryStatus` /
 * `mapLotCloseReason` branches for `reason == 4` are otherwise unexercised.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { read } from "matchstick-ts";
import { deployFuturesFixture } from "../../contracts/tests/fixtures.ts";
import { quantizePrice } from "../../contracts/tests/utils.ts";
import { pointerId, priceLevelId } from "./helpers.ts";

const conn = await network.getOrCreate();

describe("resetState: admin purge → LotClosed(RESET) + OrderClosed(RESET)", () => {
  after(() => conn.matchstick.reset());

  it("marks lots CLOSED+RESET, orders CANCELLED+RESET, and drops PriceLevel.totalQuantity", async () => {
    const { contracts, accounts, config } = await conn.networkHelpers.loadFixture(
      deployFuturesFixture,
    );
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer, pc } = accounts;

    const price = quantizePrice(await futures.read.getMarketPrice(), config.priceLadderStep);
    const restingPrice = price + config.priceLadderStep;
    const deliveryDate = config.deliveryDates[0];
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    conn.matchstick.bind("Futures", futures.address, futures.abi);
    await conn.matchstick.captureViewMocks();
    await conn.matchstick.anchor();

    // Open lot 1 (matched). Seller is short, buyer is long.
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const buyTx = await futures.write.createOrder([price, deliveryDate, "dst", 1], {
      account: buyer.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });
    const [created] = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const lotId = created.args.lotId.toLowerCase() as `0x${string}`;

    // Park a resting order from the seller at a different price so resetState
    // also produces an OrderClosed(RESET) leg.
    const restTx = await futures.write.createOrder([restingPrice, deliveryDate, "", -1], {
      account: seller.account,
    });
    const restReceipt = await pc.waitForTransactionReceipt({ hash: restTx });
    const [restingOrder] = parseEventLogs({
      logs: restReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const restingOrderId = restingOrder.args.orderId.toLowerCase() as `0x${string}`;

    // Admin purge for both participants.
    const resetTx = await futures.write.resetState(
      [[seller.account.address, buyer.account.address]],
      { account: owner.account },
    );
    const resetReceipt = await pc.waitForTransactionReceipt({ hash: resetTx });

    const lotClosedEvents = parseEventLogs({
      logs: resetReceipt.logs,
      abi: futures.abi,
      eventName: "LotClosed",
    });
    const orderClosedEvents = parseEventLogs({
      logs: resetReceipt.logs,
      abi: futures.abi,
      eventName: "OrderClosed",
    });
    assert.ok(lotClosedEvents.length >= 1, "resetState must close at least one lot");
    assert.ok(orderClosedEvents.length >= 1, "resetState must close at least one order");
    assert.ok(
      lotClosedEvents.every((e) => e.args.reason === 4),
      "every LotClosed from resetState must carry reason=4 (RESET)",
    );
    assert.ok(
      orderClosedEvents.some((e) => e.args.reason === 4),
      "at least one OrderClosed from resetState must carry reason=4 (RESET)",
    );

    const sellerAddr = seller.account.address.toLowerCase() as `0x${string}`;
    const buyerAddr = buyer.account.address.toLowerCase() as `0x${string}`;
    const restingLevel = priceLevelId(deliveryDate, restingPrice, false);

    const snap = await conn.matchstick.indexSnapshot([
      read("Lot", lotId),
      read("OrderEntry", restingOrderId),
      read("PriceLevel", restingLevel),
      read("UserDeliverySessionPointer", pointerId(seller.account.address, deliveryDate)),
      read("UserDeliverySessionPointer", pointerId(buyer.account.address, deliveryDate)),
      read("User", sellerAddr),
      read("User", buyerAddr),
    ]);

    // --- Lot closed with reason RESET ---
    const lot = snap.entity("Lot", lotId);
    assert.ok(lot);
    assert.equal(lot.status, "CLOSED");
    assert.equal(lot.closeReason, "RESET", "Lot.closeReason must map reason=4 to RESET");
    assert.equal(lot.isClosed, true);
    // resetState passes sellerPnl=buyerPnl=0 and closedBy=address(0) by design.
    assert.equal(String(lot.sellerPnl), "0", "RESET close zeros both pnls by contract design");
    assert.equal(String(lot.buyerPnl), "0");

    // --- Resting OrderEntry flipped to RESET ---
    const entry = snap.entity("OrderEntry", restingOrderId);
    assert.ok(entry);
    assert.equal(
      entry.status,
      "RESET",
      "OrderEntry.status must map OrderCloseReason.RESET to OrderEntryStatus.RESET",
    );

    // --- PriceLevel drained ---
    assert.equal(
      String(snap.entity("PriceLevel", restingLevel)?.totalQuantity),
      "0",
      "PriceLevel.totalQuantity must drop to 0 after resetState closes the resting order",
    );

    // --- Pointers do NOT auto-zero on RESET; the contract emits no
    //     PositionExited event, only LotClosed. The indexer's LotClosed
    //     handler still calls applyExitFill for both sides, which decrements
    //     netQty back to zero. Verify that explicitly.
    const sellerPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(seller.account.address, deliveryDate),
    );
    const buyerPtr = snap.entity(
      "UserDeliverySessionPointer",
      pointerId(buyer.account.address, deliveryDate),
    );
    assert.ok(sellerPtr);
    assert.ok(buyerPtr);
    assert.equal(String(sellerPtr.netQuantity), "0", "seller must be flat after RESET");
    assert.equal(String(buyerPtr.netQuantity), "0", "buyer must be flat after RESET");
  });
});
