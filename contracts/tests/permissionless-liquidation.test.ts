import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits, parseEventLogs, zeroHash } from "viem";
import type { NetworkConnection } from "hardhat/types/network";
import { deployFuturesFixture } from "./fixtures.ts";
import { scaleHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * Phase 0 of the unified margin keeper plan: permissionless `liquidateOrder`,
 * `liquidateOrders`, `liquidatePosition` with strict orders-first invariant.
 *
 * Surface under test:
 *   - liquidateOrder(participant, id)
 *   - liquidateOrders(participant)              — FIFO sweep until healthy
 *   - liquidatePosition(participant, positionId) — reverts OrdersStillOpen if any orders remain
 *   - setLiquidationFee — single flat fee charged per cancelled order and per closed position
 *
 * The legacy validator-only `marginCall` entry point is exercised by
 * `liquidation.test.ts` and continues to work for the existing Lambda; it is
 * kept in place during the cutover and removed in a Phase 4 follow-up.
 */
async function underwaterWithOrdersAndPositionFixture(conn: NetworkConnection) {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, collateralVault } = contracts;
  const { seller, buyer, buyer2, owner, pc } = accounts;

  const entryPricePerDay = await futures.read.getMarketPrice();
  const deliveryDate = config.deliveryDates[0];

  // Tight collateral so a hashprice drop drives the buyer underwater. Mirrors the
  // sizing pattern from `liquidation.test.ts` "should close orders first" so the
  // buyer is healthy at entry but breaks MM once price drops.
  const positionMargin = entryPricePerDay * 3n;
  const orderHeadroom =
    ((entryPricePerDay * BigInt(config.deliveryDurationDays) * BigInt(config.liquidationMarginPercent)) /
      100n) *
    2n;
  const buyerMargin = positionMargin + orderHeadroom;

  await collateralVault.write.deposit([positionMargin], { account: seller.account });
  await collateralVault.write.deposit([buyerMargin], { account: buyer.account });
  await collateralVault.write.deposit([positionMargin], { account: buyer2.account });

  // Open a matched position: seller short, buyer long.
  await futures.write.createOrder([entryPricePerDay, deliveryDate, "", -1], {
    account: seller.account,
  });
  const matchTx = await futures.write.createOrder([entryPricePerDay, deliveryDate, "", 1], {
    account: buyer.account,
  });
  const matchReceipt = await pc.waitForTransactionReceipt({ hash: matchTx });
  const [positionEvt] = parseEventLogs({
    logs: matchReceipt.logs,
    abi: futures.abi,
    eventName: "LotCreated",
  });
  const positionId = positionEvt.args.lotId;

  // Two extra resting BUY orders for buyer at the matched price. Same-side as the
  // position so they aren't auto-offset; once the hashprice drops they go deeply
  // negative-PnL and blow up `getFuturesOrderMargin`, breaking MM.
  await futures.write.createOrder([entryPricePerDay, deliveryDate, "", 1], {
    account: buyer.account,
  });
  await futures.write.createOrder([entryPricePerDay, deliveryDate, "", 1], {
    account: buyer.account,
  });

  const liquidationFee = parseUnits("1", 6);
  await futures.write.setLiquidationFee([liquidationFee], { account: owner.account });

  return {
    ...data,
    config: { ...config, entryPricePerDay, deliveryDate, liquidationFee },
    positionId,
    async makeUnderwater() {
      // Drop hashprice aggressively so the buyer (long) breaks MM even after
      // resting orders are force-cancelled by the keeper's first step. Picking
      // 100/300 (~66% drop) keeps the test resilient to the size of the order
      // MM contribution while still leaving the position itself underwater.
      await scaleHashprice(contracts.hashrateOracle, 100n, 300n);
    },
  };
}

describe("Futures - permissionless liquidation entry points", function () {
  describe("setLiquidationFee", function () {
    it("only owner can set the fee", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { buyer } = accounts;

      await assert.rejects(
        futures.write.setLiquidationFee([1n], { account: buyer.account }),
      );
    });

    it("emits LiquidationFeeUpdated and persists the new value", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures } = contracts;
      const { owner, pc } = accounts;

      const liqFee = parseUnits("2", 6);

      const tx = await futures.write.setLiquidationFee([liqFee], { account: owner.account });
      const receipt = await pc.waitForTransactionReceipt({ hash: tx });
      const [event] = parseEventLogs({
        logs: receipt.logs,
        abi: futures.abi,
        eventName: "LiquidationFeeUpdated",
      });
      assert.equal(event.args.newLiquidationFee, liqFee);

      assert.equal(await futures.read.liquidationFee(), liqFee);
    });
  });

  describe("liquidateOrder", function () {
    it("reverts NotLiquidatable when participant is healthy", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(
        underwaterWithOrdersAndPositionFixture,
      );
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      const orders = await futures.read.getOrderIds([buyer.account.address]);
      assert.ok(orders.length > 0);

      await viem.assertions.revertWithCustomError(
        futures.write.liquidateOrder([buyer.account.address, orders[0]], {
          account: buyer2.account,
        }),
        futures,
        "NotLiquidatable",
      );
    });

    it("reverts OrderNotBelongToParticipant when id is owned by someone else", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts } = data;
      const { futures } = contracts;
      const { seller, buyer, buyer2 } = accounts;

      await data.makeUnderwater();

      const buyerOrders = await futures.read.getOrderIds([buyer.account.address]);
      assert.ok(buyerOrders.length > 0);

      // Seller is healthy at this point too (price drop benefits the short), so we use
      // the buyer (underwater) and pass an unrelated id (`zeroHash`) to provoke the
      // ownership check.
      await viem.assertions.revertWithCustomError(
        futures.write.liquidateOrder([buyer.account.address, zeroHash], {
          account: buyer2.account,
        }),
        futures,
        "OrderNotBelongToParticipant",
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

    it("cancels the order, pays liquidationFee, and emits events", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, config } = data;
      const { futures, collateralVault } = contracts;
      const { buyer, buyer2, pc } = accounts;

      await data.makeUnderwater();

      const ordersBefore = await futures.read.getOrderIds([buyer.account.address]);
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

      assert.equal(liqBalAfter - liqBalBefore, config.liquidationFee);
      assert.equal(userBalBefore - userBalAfter, config.liquidationFee);

      const ordersAfter = await futures.read.getOrderIds([buyer.account.address]);
      assert.equal(ordersAfter.length, 1);
      assert.ok(!ordersAfter.includes(target));

      const events = parseEventLogs({ logs: receipt.logs, abi: futures.abi });
      const orderClosed = events.find(
        (e: any) => e.eventName === "OrderClosed" && e.args.orderId === target,
      ) as any;
      const orderLiquidated = events.find(
        (e: any) => e.eventName === "OrderLiquidated" && e.args.orderId === target,
      ) as any;
      assert.ok(orderClosed, "OrderClosed should be emitted for indexer compatibility");
      assert.ok(orderLiquidated);
      assert.equal(orderLiquidated.args.fee, config.liquidationFee);
    });

    it("caps fee at participant's vault balance", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts } = data;
      const { futures, collateralVault } = contracts;
      const { buyer, buyer2, owner } = accounts;

      await data.makeUnderwater();

      const huge = parseUnits("100000", 6);
      await futures.write.setLiquidationFee([huge], { account: owner.account });

      const userBalBefore = await collateralVault.read.balanceOf([buyer.account.address]);
      const liqBalBefore = await collateralVault.read.balanceOf([buyer2.account.address]);

      const orders = await futures.read.getOrderIds([buyer.account.address]);
      await futures.write.liquidateOrder([buyer.account.address, orders[0]], {
        account: buyer2.account,
      });

      const userBalAfter = await collateralVault.read.balanceOf([buyer.account.address]);
      const liqBalAfter = await collateralVault.read.balanceOf([buyer2.account.address]);

      assert.equal(userBalAfter, 0n);
      assert.equal(liqBalAfter - liqBalBefore, userBalBefore);
    });
  });

  describe("liquidateOrders (FIFO sweep)", function () {
    it("reverts NotLiquidatable when participant is healthy", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(
        underwaterWithOrdersAndPositionFixture,
      );
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.liquidateOrders([buyer.account.address], { account: buyer2.account }),
        futures,
        "NotLiquidatable",
      );
    });

    it("cancels all orders FIFO and pays per-order fee", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, config } = data;
      const { futures, collateralVault } = contracts;
      const { buyer, buyer2 } = accounts;

      await data.makeUnderwater();

      const ordersBefore = await futures.read.getOrderIds([buyer.account.address]);
      assert.equal(ordersBefore.length, 2);

      const liqBalBefore = await collateralVault.read.balanceOf([buyer2.account.address]);

      await futures.write.liquidateOrders([buyer.account.address], { account: buyer2.account });

      const liqBalAfter = await collateralVault.read.balanceOf([buyer2.account.address]);
      const ordersAfter = await futures.read.getOrderIds([buyer.account.address]);

      assert.equal(ordersAfter.length, 0);
      // At most `len * fee`; possibly less if MM became healthy partway.
      assert.ok(
        liqBalAfter - liqBalBefore <= config.liquidationFee * BigInt(ordersBefore.length),
      );
      assert.ok(liqBalAfter - liqBalBefore >= config.liquidationFee);
    });
  });

  describe("liquidatePosition", function () {
    it("reverts PositionNotExists for unknown id", async function () {
      const { contracts, accounts } = await networkHelpers.loadFixture(
        underwaterWithOrdersAndPositionFixture,
      );
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([buyer.account.address, zeroHash], {
          account: buyer2.account,
        }),
        futures,
        "PositionNotExists",
      );
    });

    it("reverts PositionNotBelongToParticipant when participant is neither side", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, positionId } = data;
      const { futures } = contracts;
      const { buyer2 } = accounts;

      // buyer2 is not on either side of the position.
      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([buyer2.account.address, positionId], {
          account: buyer2.account,
        }),
        futures,
        "PositionNotBelongToParticipant",
      );
    });

    it("reverts OrdersStillOpen when participant has resting orders", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, positionId } = data;
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      await data.makeUnderwater();

      const ordersBefore = await futures.read.getOrderIds([buyer.account.address]);
      assert.ok(ordersBefore.length > 0);

      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([buyer.account.address, positionId], {
          account: buyer2.account,
        }),
        futures,
        "OrdersStillOpen",
      );
    });

    it("reverts NotLiquidatable when participant is healthy (no orders)", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, positionId } = data;
      const { futures } = contracts;
      const { buyer, buyer2 } = accounts;

      // Cancel buyer's resting orders permissionlessly is gated by underwater predicate, so
      // for "healthy + no orders" we cancel them via the participant themselves first.
      const orders = await futures.read.getOrderIds([buyer.account.address]);
      for (const id of orders) {
        await futures.write.closeOrder([id], { account: buyer.account });
      }

      // No price move — buyer remains healthy.
      await viem.assertions.revertWithCustomError(
        futures.write.liquidatePosition([buyer.account.address, positionId], {
          account: buyer2.account,
        }),
        futures,
        "NotLiquidatable",
      );
    });

    it("succeeds after orders are cleared via liquidateOrders + cash-settles position", async function () {
      const data = await networkHelpers.loadFixture(underwaterWithOrdersAndPositionFixture);
      const { contracts, accounts, positionId, config } = data;
      const { futures, collateralVault } = contracts;
      const { buyer, buyer2, pc } = accounts;

      await data.makeUnderwater();

      // Step 1: clear orders.
      await futures.write.liquidateOrders([buyer.account.address], { account: buyer2.account });
      assert.equal((await futures.read.getOrderIds([buyer.account.address])).length, 0);

      const liqBalBefore = await collateralVault.read.balanceOf([buyer2.account.address]);

      // Step 2: close the position.
      const tx = await futures.write.liquidatePosition([buyer.account.address, positionId], {
        account: buyer2.account,
      });
      const receipt = await pc.waitForTransactionReceipt({ hash: tx });

      // Position is removed from storage.
      const after = await futures.read.getPositionById([positionId]);
      assert.equal(after.seller, "0x0000000000000000000000000000000000000000");

      const events = parseEventLogs({ logs: receipt.logs, abi: futures.abi });
      const positionClosed = events.find((e: any) => e.eventName === "LotClosed") as any;
      const positionLiquidated = events.find((e: any) => e.eventName === "LotLiquidated") as any;
      assert.ok(positionClosed, "LotClosed should be emitted for indexer compatibility");
      assert.ok(positionLiquidated);
      assert.equal(positionLiquidated.args.lotId, positionId);

      const liqBalAfter = await collateralVault.read.balanceOf([buyer2.account.address]);
      // Liquidator gets at most the fee (could be less if buyer's vault was wiped by PnL).
      assert.ok(liqBalAfter - liqBalBefore <= config.liquidationFee);
    });
  });
});
