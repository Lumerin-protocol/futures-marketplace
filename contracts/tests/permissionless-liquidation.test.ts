import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits, parseEventLogs, zeroHash } from "viem";
import type { NetworkConnection } from "hardhat/types/network";
import { deployFuturesFixture } from "./fixtures.ts";
import { scaleHashprice } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * Permissionless liquidation suite: `liquidateOrder`, `liquidateOrders`,
 * `liquidatePosition` with the strict orders-first invariant.
 *
 * Surface under test:
 *   - liquidateOrder(participant, id)
 *   - liquidateOrders(participant, orderIds)    — keeper-chosen ids, stop-on-failure
 *   - liquidatePosition(participant, expirationAt, closeQty) — reverts OrdersStillOpen if any orders remain
 *   - setLiquidationFeeBps — bps fee on notional, charged per cancelled order and per closed position
 */
async function underwaterWithOrdersAndPositionFixture(conn: NetworkConnection) {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, collateralVault } = contracts;
  const { seller, buyer, buyer2, owner, pc } = accounts;

  const entryPricePerDay = await futures.read.getMarketPrice();
  const deliveryDate = config.deliveryDates[0];

  // Seller / buyer2 are amply funded — they stay healthy through the crash.
  const positionMargin = entryPricePerDay * 3n;
  // The buyer is funded tight: enough to open the long plus two resting buys
  // (entry IM ≈ 0.6× entry), but below the maintenance margin the long alone
  // imposes once a deep hashprice crash is applied. A long contract's loss is
  // bounded by its entry price (the mark can't go negative), so with the
  // duration multiplier gone the deposit must sit under 1× entry for the
  // position to stay underwater even after the resting orders are cancelled.
  const buyerMargin = (entryPricePerDay * 4n) / 5n;

  await collateralVault.write.deposit([positionMargin], { account: seller.account });
  await collateralVault.write.deposit([buyerMargin], { account: buyer.account });
  await collateralVault.write.deposit([positionMargin], { account: buyer2.account });

  // Open a matched position: seller short, buyer long.
  await futures.write.createOrder([entryPricePerDay, deliveryDate, -1n, TimeInForce.GTC], {
    account: seller.account,
  });
  await futures.write.createOrder([entryPricePerDay, deliveryDate, 1n, TimeInForce.GTC], {
    account: buyer.account,
  });

  // Two extra resting BUY orders for buyer at the matched price. Same-side as the
  // position, so the engine adds their delta to it on the buy stress leg rather than
  // netting them off; once the hashprice drops, that leg plus their growing fill loss
  // breaks MM.
  await futures.write.createOrder([entryPricePerDay, deliveryDate, 1n, TimeInForce.GTC], {
    account: buyer.account,
  });
  await futures.write.createOrder([entryPricePerDay, deliveryDate, 1n, TimeInForce.GTC], {
    account: buyer.account,
  });

  await futures.write.setLiquidationFeeBps([50], { account: owner.account });

  return {
    ...data,
    config: { ...config, entryPricePerDay, deliveryDate },
    async makeUnderwater() {
      // Drop hashprice deeply (÷20) so the buyer (long) breaks MM even after
      // resting orders are force-cancelled by the keeper's first step. The MM
      // includes the position's mark-to-market loss (`futuresUnrealizedLoss`), so
      // a deep drop leaves the position itself underwater once the order-margin
      // contribution is gone — no reliance on any liquidation-fee balance drain.
      await scaleHashprice(contracts.hashpriceUsd, 1n, 20n);
    },
  };
}

describe("Futures - permissionless liquidation entry points", function () {
  describe("setLiquidationFeeBps", function () {
    it("only owner can set the fee", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { buyer } = accounts;

      await assert.rejects(futures.write.setLiquidationFeeBps([50], { account: buyer.account }));
    });

    it("emits LiquidationFeeBpsUpdated and persists the value", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner, pc } = accounts;

      const tx = await futures.write.setLiquidationFeeBps([50], { account: owner.account });
      const receipt = await pc.waitForTransactionReceipt({ hash: tx });
      const [event] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LiquidationFeeBpsUpdated",
      });
      assert.equal(event.args.newLiquidationFeeBps, 50);

      assert.equal(await futures.read.liquidationFeeBps(), 50);
    });
  });

  describe("liquidateOrder", function () {
    it("reverts NotLiquidatable when participant is healthy", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(
        underwaterWithOrdersAndPositionFixture,
      );
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      const orders = await futures.read.getUserOrders([buyer.account.address]);
      assert.ok(orders.length > 0);

      await viem.assertions.revertWithCustomError(
        futures.write.liquidateOrder([buyer.account.address, orders[0]], {
          account: buyer2.account,
        }),
        futures,
        "NotLiquidatable",
      );
    });

    it("reverts OrderNotBelongToUser when id is owned by someone else", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts } = data;
      const { futures } = contracts;
      const { seller, buyer, buyer2 } = accounts;

      await data.makeUnderwater();

      const buyerOrders = await futures.read.getUserOrders([buyer.account.address]);
      assert.ok(buyerOrders.length > 0);

      // Seller is healthy at this point too (price drop benefits the short), so we use
      // the buyer (underwater) and pass an unrelated id (`zeroHash`) to provoke the
      // ownership check.
      await viem.assertions.revertWithCustomError(
        futures.write.liquidateOrder([buyer.account.address, zeroHash], {
          account: buyer2.account,
        }),
        futures,
        "OrderNotBelongToUser",
      );

      // And: the predicate-then-ownership ordering — seller is healthy, so passing a
      // buyer-owned id with seller's address should hit the predicate first.
      await viem.assertions.revertWithCustomError(
        futures.write.liquidateOrder([seller.account.address, buyerOrders[0]], {
          account: buyer2.account,
        }),
        futures,
        "NotLiquidatable",
      );
    });

    it("cancels the order without paying a fee (payout disabled), and emits events", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts } = data;
      const { futures, collateralVault } = contracts;
      const { buyer, buyer2, pc } = accounts;

      await data.makeUnderwater();

      const ordersBefore = await futures.read.getUserOrders([buyer.account.address]);
      assert.equal(ordersBefore.length, 2);
      const target = ordersBefore[0];

      const liqBalBefore = await collateralVault.read.balanceOf([buyer2.account.address]);
      const userBalBefore = await collateralVault.read.balanceOf([buyer.account.address]);

      const tx = await futures.write.liquidateOrder([buyer.account.address, target], {
        account: buyer2.account,
      });
      const receipt = await pc.waitForTransactionReceipt({ hash: tx });

      const liqBalAfter = await collateralVault.read.balanceOf([buyer2.account.address]);
      const userBalAfter = await collateralVault.read.balanceOf([buyer.account.address]);

      // Liquidator gets nothing (liquidatorShareBps defaults to 0).
      assert.equal(liqBalAfter, liqBalBefore);
      // User pays the fee to the insurance fund.
      assert.ok(userBalBefore > userBalAfter, "user should pay liquidation fee");

      const ordersAfter = await futures.read.getUserOrders([buyer.account.address]);
      assert.equal(ordersAfter.length, 1);
      assert.ok(!ordersAfter.includes(target));

      const events = parseEventLogs({ logs: receipt.logs, abi: futures.abi });
      const orderCancelled = events.find(
        (e: any) => e.eventName === "OrderCancelled" && e.args.orderId === target,
      ) as any;
      const orderLiquidated = events.find(
        (e: any) => e.eventName === "OrderLiquidated" && e.args.orderId === target,
      ) as any;
      assert.ok(orderCancelled, "OrderCancelled should be emitted when order is liquidated");
      assert.ok(orderLiquidated);
      assert.ok(orderLiquidated.args.fee > 0n, "fee should be non-zero");
    });

    it("does not transfer any fee even when liquidationFeeBps is set high (payout disabled)", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts } = data;
      const { futures, collateralVault } = contracts;
      const { buyer, buyer2, owner } = accounts;

      await data.makeUnderwater();

      await futures.write.setLiquidationFeeBps([10000], { account: owner.account });

      const userBalBefore = await collateralVault.read.balanceOf([buyer.account.address]);
      const liqBalBefore = await collateralVault.read.balanceOf([buyer2.account.address]);

      const orders = await futures.read.getUserOrders([buyer.account.address]);
      await futures.write.liquidateOrder([buyer.account.address, orders[0]], {
        account: buyer2.account,
      });

      const userBalAfter = await collateralVault.read.balanceOf([buyer.account.address]);
      const liqBalAfter = await collateralVault.read.balanceOf([buyer2.account.address]);

      // Liquidator still gets 0 at default share. User pays what they can.
      assert.equal(liqBalAfter, liqBalBefore, "liquidator balance unchanged");
      assert.ok(userBalAfter <= userBalBefore, "user paid the fee");
    });
  });

  describe("liquidateOrders (keeper-chosen ids, stop-on-failure)", function () {
    it("reverts NotLiquidatable when participant is healthy", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(
        underwaterWithOrdersAndPositionFixture,
      );
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      const ids = await futures.read.getUserOrders([buyer.account.address]);
      await viem.assertions.revertWithCustomError(
        futures.write.liquidateOrders([buyer.account.address, ids], { account: buyer2.account }),
        futures,
        "NotLiquidatable",
      );
    });

    it("cancels supplied orders without paying a fee (payout disabled)", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts } = data;
      const { futures, collateralVault } = contracts;
      const { buyer, buyer2 } = accounts;

      await data.makeUnderwater();

      const ordersBefore = await futures.read.getUserOrders([buyer.account.address]);
      assert.equal(ordersBefore.length, 2);

      const liqBalBefore = await collateralVault.read.balanceOf([buyer2.account.address]);

      await futures.write.liquidateOrders([buyer.account.address, ordersBefore], {
        account: buyer2.account,
      });

      const liqBalAfter = await collateralVault.read.balanceOf([buyer2.account.address]);
      const ordersAfter = await futures.read.getUserOrders([buyer.account.address]);

      assert.equal(ordersAfter.length, 0);
      // Liquidator gets nothing (liquidatorShareBps defaults to 0).
      assert.equal(liqBalAfter, liqBalBefore);
    });
  });

  describe("liquidatePosition", function () {
    it("reverts NotLiquidatable for unknown expirationAt with zero net", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, config } = data;
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      await data.makeUnderwater();
      const orderIds = await futures.read.getUserOrders([buyer.account.address]);
      await futures.write.liquidateOrders([buyer.account.address, orderIds], {
        account: buyer2.account,
      });

      const unknownDate = config.deliveryDates[1];
      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([buyer.account.address, unknownDate, 1n], {
          account: buyer2.account,
        }),
        futures,
        "NotLiquidatable",
      );
    });

    it("reverts NotLiquidatable when user has no position at expirationAt", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, config } = data;
      const { futures } = contracts;
      const { buyer2 } = accounts;

      // buyer2 has no position at this delivery — only buyer/seller matched.
      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([buyer2.account.address, config.deliveryDate, 1n], {
          account: buyer2.account,
        }),
        futures,
        "NotLiquidatable",
      );
    });

    it("reverts OrdersStillOpen when participant has resting orders", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, config } = data;
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      await data.makeUnderwater();

      const ordersBefore = await futures.read.getUserOrders([buyer.account.address]);
      assert.ok(ordersBefore.length > 0);

      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([buyer.account.address, config.deliveryDate, 1n], {
          account: buyer2.account,
        }),
        futures,
        "OrdersStillOpen",
      );
    });

    it("reverts NotLiquidatable when participant is healthy (no orders)", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, config } = data;
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      // Cancel buyer's resting orders permissionlessly is gated by underwater predicate, so
      // for "healthy + no orders" we cancel them via the participant themselves first.
      const orders = await futures.read.getUserOrders([buyer.account.address]);
      for (const id of orders) {
        await futures.write.cancelOrder([id], { account: buyer.account });
      }

      // No price move — buyer remains healthy.
      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([buyer.account.address, config.deliveryDate, 1n], {
          account: buyer2.account,
        }),
        futures,
        "NotLiquidatable",
      );
    });

    it("succeeds after orders are cleared via liquidateOrders and cash-settles the user's aggregate", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, config } = data;
      const { futures, collateralVault } = contracts;
      const { buyer, seller, buyer2, pc } = accounts;

      await data.makeUnderwater();

      // Step 1: clear orders.
      const orderIds = await futures.read.getUserOrders([buyer.account.address]);
      await futures.write.liquidateOrders([buyer.account.address, orderIds], {
        account: buyer2.account,
      });
      assert.equal((await futures.read.getUserOrders([buyer.account.address])).length, 0);

      const liqBalBefore = await collateralVault.read.balanceOf([buyer2.account.address]);

      // Step 2: close the buyer's aggregate at expirationAt.
      const tx = await futures.write.liquidatePosition(
        [buyer.account.address, config.deliveryDate, 1n],
        { account: buyer2.account },
      );
      const receipt = await pc.waitForTransactionReceipt({ hash: tx });

      const buyerPos = await futures.read.getUserPosition([
        buyer.account.address,
        config.deliveryDate,
      ]);
      assert.equal(buyerPos.netQuantity, 0n, "buyer's aggregate should be fully closed");

      // Unilateral: seller's short aggregate is untouched.
      const sellerPos = await futures.read.getUserPosition([
        seller.account.address,
        config.deliveryDate,
      ]);
      assert.equal(sellerPos.netQuantity, -1n, "seller's aggregate remains open");

      const [positionLiquidated] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "PositionLiquidated",
      });
      assert.equal(positionLiquidated.args.expirationAt, config.deliveryDate);
      assert.equal(positionLiquidated.args.closedQuantity, 1n);

      const liqBalAfter = await collateralVault.read.balanceOf([buyer2.account.address]);
      // Liquidator fee is zero (liquidationFeeBps = 50, but the user may have nothing).
      assert.ok(liqBalAfter >= liqBalBefore);
    });
  });
});
