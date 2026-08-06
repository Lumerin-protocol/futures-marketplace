import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import type { NetworkConnection } from "hardhat/types/network";
import { deployFuturesFixture } from "./fixtures.ts";
import { scaleHashprice } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * `liquidatePositions(user, expirationAts[], closeQtys[])` — batched close-to-IM liquidation.
 *
 * Keeper-chosen legs; stop when healthy. Each leg's `closeQty` is an upper
 * bound; an oversize partial reverts `OverLiquidation` when leftover balance
 * sits above IM with a real IM > MM buffer. Fully-closed accounts skip that
 * guard (bad-debt path). The keeper sizes worst-first off-chain.
 *
 * Fixture shape (chosen so behaviour is robust to PME rounding):
 *   - PME shocks IM 20% / MM 10% → a genuine buffer (IM > MM).
 *   - 10 long contracts for `buyer`, matched by `seller`.
 *   - Deposit ≈ 2.2·(entry·10)/10 — clears entry IM (2.0·u) so the
 *     position opens, but a 15% hashprice crash breaks MM (MM_req₀ ≈ 2.35·u).
 *   - After the crash: closing a FEW contracts stays at/under IM,
 *     closing almost ALL contracts overshoots IM, closing EVERY contract is a
 *     full close.
 */
async function partialLiquidationFixture(_conn: NetworkConnection) {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, portfolioMarginEngine, collateralVault } = contracts;
  const { seller, buyer, buyer2, owner, pc } = accounts;

  // Real IM > MM buffer (deployFuturesFixture sets both equal by default).
  const imShock = parseUnits("0.20", 18);
  const mmShock = parseUnits("0.10", 18);
  await portfolioMarginEngine.write.setShocks([imShock, mmShock, 0n, 0n], {
    account: owner.account,
  });
  // Zero trading fees so the deposit math is purely margin-driven (fees are
  // exercised by the dedicated fee/liquidation suites, not here).
  await futures.write.setMakerFeeBps([0], { account: owner.account });
  await futures.write.setTakerFeeBps([0], { account: owner.account });

  const entry = await futures.read.getMarketPrice();
  const deliveryDate = config.deliveryDates[0];
  const lotCount = 10n;

  // u = entry (per-contract notional; one contract settles pricePerDay, no duration
  // multiplier). Deposit 2.2·u·(lotCount/10) = 2.2·u for 10 contracts. See header for
  // why this lands underwater-but-partially-recoverable.
  const u = entry;
  const buyerDeposit = (u * 22n) / 10n;
  const bigDeposit = u * 100n;

  await collateralVault.write.deposit([buyerDeposit], { account: buyer.account });
  await collateralVault.write.deposit([bigDeposit], { account: seller.account });
  await collateralVault.write.deposit([bigDeposit], { account: buyer2.account });

  // Open 10 matched long contracts for buyer (seller short).
  await futures.write.createOrder([entry, deliveryDate, -lotCount, TimeInForce.GTC], {
    account: seller.account,
  });
  const matchTx = await futures.write.createOrder(
    [entry, deliveryDate, lotCount, TimeInForce.GTC],
    {
      account: buyer.account,
    },
  );
  await pc.waitForTransactionReceipt({ hash: matchTx });

  // A foreign position (buyer2 long vs seller) — used to prove partial liquidation
  // only reduces the target user's aggregate.
  await futures.write.createOrder([entry, deliveryDate, -1n, TimeInForce.GTC], {
    account: seller.account,
  });
  await futures.write.createOrder([entry, deliveryDate, 1n, TimeInForce.GTC], {
    account: buyer2.account,
  });

  return {
    ...data,
    config: { ...config, entry, deliveryDate, lotCount },
    /** 15% hashprice crash — moderate: breaks MM but keeps a recoverable band. */
    async makeUnderwater() {
      await scaleHashprice(contracts.hashpriceUsd, 85n, 100n);
    },
  };
}

describe("Futures - liquidatePositions (batched close-to-IM)", function () {
  it("reverts NotLiquidatable when the participant is healthy", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    const dates = await futures.read.getActiveExpirationDates([buyer.account.address]);
    assert.ok(dates.length > 0);

    // No crash — buyer remains healthy, so the batch entry point rejects.
    await viem.assertions.revertWithCustomError(
      futures.write.liquidatePositions(
        [buyer.account.address, [config.deliveryDate], [config.lotCount]],
        { account: buyer2.account },
      ),
      futures,
      "NotLiquidatable",
    );
  });

  it("reverts OrdersStillOpen when the participant has resting orders", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    // A stale far-out-of-market resting buy order that never matches.
    await futures.write.createOrder([config.entry / 2n, config.deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });

    await data.makeUnderwater();

    await viem.assertions.revertWithCustomError(
      futures.write.liquidatePositions(
        [buyer.account.address, [config.deliveryDate], [config.lotCount]],
        { account: buyer2.account },
      ),
      futures,
      "OrdersStillOpen",
    );
  });

  it("closes the supplied subset in one call and pays no over-liquidation", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { buyer, buyer2, pc } = accounts;

    await data.makeUnderwater();

    const closeQty = 2n;
    const tx = await futures.write.liquidatePositions(
      [buyer.account.address, [config.deliveryDate], [closeQty]],
      { account: buyer2.account },
    );
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const posAfter = await futures.read.getUserPosition([
      buyer.account.address,
      config.deliveryDate,
    ]);
    assert.equal(posAfter.netQuantity, config.lotCount - closeQty);

    const liquidated = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionLiquidated",
    });
    assert.equal(liquidated.length, 1);
    assert.equal(liquidated[0].args.closedQuantity, closeQty);
  });

  it("skips zero-net expiries but still closes the owned quantity", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    await data.makeUnderwater();

    // Unknown expiry first, then a valid close — stale legs are skipped.
    const unknownDate = config.deliveryDates[1];
    const closeQty = 2n;

    await futures.write.liquidatePositions(
      [buyer.account.address, [unknownDate, config.deliveryDate], [5n, closeQty]],
      { account: buyer2.account },
    );

    const buyerPos = await futures.read.getUserPosition([
      buyer.account.address,
      config.deliveryDate,
    ]);
    assert.equal(buyerPos.netQuantity, config.lotCount - closeQty);

    // The foreign position (buyer2) is untouched — unilateral liquidation.
    const foreignPos = await futures.read.getUserPosition([
      buyer2.account.address,
      config.deliveryDate,
    ]);
    assert.equal(foreignPos.netQuantity, 1n);
  });

  it("reverts NotLiquidatable when nothing in the supplied set could be closed", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    await data.makeUnderwater();

    // Underwater, but every supplied expiry has zero net or zero close qty.
    const unknownDate = config.deliveryDates[1];
    await viem.assertions.revertWithCustomError(
      futures.write.liquidatePositions(
        [buyer.account.address, [unknownDate, config.deliveryDates[2]], [1n, 0n]],
        { account: buyer2.account },
      ),
      futures,
      "NotLiquidatable",
    );
  });

  it("reverts OverLiquidation when an oversize partial leaves balance above IM", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    await data.makeUnderwater();

    // Request all-but-one — residual IM is tiny vs leftover balance.
    const tooMany = config.lotCount - 1n;

    await viem.assertions.revertWithCustomError(
      futures.write.liquidatePositions([buyer.account.address, [config.deliveryDate], [tooMany]], {
        account: buyer2.account,
      }),
      futures,
      "OverLiquidation",
    );
  });

  it("skips the over-liquidation guard on a full close (all contracts gone)", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    await data.makeUnderwater();

    // Closing EVERY contract leaves no positions, so the guard is skipped even
    // though the residual balance sits above (a now-zero) IM.
    await futures.write.liquidatePositions(
      [buyer.account.address, [config.deliveryDate], [config.lotCount]],
      { account: buyer2.account },
    );

    const after = await futures.read.getActiveExpirationDates([buyer.account.address]);
    assert.equal(after.length, 0, "buyer's aggregate at deliveryDate should be fully closed");
  });

  it("records BadDebt when the loser can't cover on a full close", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { seller, buyer, buyer2, pc } = accounts;

    // Deep 99% hashprice crash: the long buyer's realized loss on a full close
    // dwarfs their deposit. Uncovered loss is recorded as BadDebt; the buyer's
    // available collateral is swept to the insurance fund. The seller's short
    // aggregate stays open — unilateral liquidation does not pay the counterparty.
    await scaleHashprice(hashpriceUsd, 1n, 100n);

    const marketAfter = await futures.read.getMarketPrice();
    const buyerPosBefore = await futures.read.getUserPosition([
      buyer.account.address,
      config.deliveryDate,
    ]);
    const absQty =
      buyerPosBefore.netQuantity > 0n ? buyerPosBefore.netQuantity : -buyerPosBefore.netQuantity;

    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const insuranceAddr = await collateralVault.read.INSURANCE_FUND_ADDR();
    const insuranceBefore = await collateralVault.read.balanceOf([insuranceAddr]);

    const tx = await futures.write.liquidatePositions(
      [buyer.account.address, [config.deliveryDate], [absQty]],
      { account: buyer2.account },
    );
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const idsAfter = await futures.read.getActiveExpirationDates([buyer.account.address]);
    assert.equal(idsAfter.length, 0, "buyer fully closed");

    const badDebt = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "BadDebt" });
    assert.ok(badDebt.length >= 1, "expected at least one BadDebt event on the uncovered loss");
    let uncovered = 0n;
    for (const evt of badDebt) {
      assert.equal(
        getAddress(evt.args.user),
        getAddress(buyer.account.address),
        "BadDebt should be attributed to the insolvent buyer",
      );
      uncovered += evt.args.amount;
    }
    const expectedLoss = buyerPosBefore.netEntryValue - marketAfter * absQty;
    const expectedShortfall = expectedLoss - buyerBalanceBefore;
    assert.equal(
      uncovered,
      expectedShortfall,
      "BadDebt amount == the portion of the loss the buyer's collateral couldn't cover",
    );

    const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    assert.equal(buyerBalanceAfter, 0n, "buyer collateral fully drained");

    // Seller is not paid until they close their own aggregate.
    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    assert.equal(
      sellerBalanceAfter,
      sellerBalanceBefore,
      "seller balance unchanged on buyer liquidation",
    );

    const sellerPos = await futures.read.getUserPosition([
      seller.account.address,
      config.deliveryDate,
    ]);
    assert.equal(sellerPos.netQuantity, -config.lotCount - 1n, "seller short remains open");

    // Insurance fund absorbs the buyer's available collateral.
    const insuranceAfter = await collateralVault.read.balanceOf([insuranceAddr]);
    assert.equal(
      insuranceAfter - insuranceBefore,
      buyerBalanceBefore,
      "insurance fund received the buyer's available collateral",
    );
  });

  it("degenerate IM <= MM: no upper-bound revert even when over-closing", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures, portfolioMarginEngine } = contracts;
    const { buyer, buyer2, owner } = accounts;

    // Collapse the buffer: IM == MM. The clamp's `im > mm` precondition is
    // false, so there's no over-liquidation ceiling.
    const shock = parseUnits("0.10", 18);
    await portfolioMarginEngine.write.setShocks([shock, shock, 0n, 0n], {
      account: owner.account,
    });

    await data.makeUnderwater();

    const tooMany = config.lotCount - 1n;

    // Same "close all-but-one" closes the full requested amount when IM==MM.
    await futures.write.liquidatePositions(
      [buyer.account.address, [config.deliveryDate], [tooMany]],
      { account: buyer2.account },
    );

    const posAfter = await futures.read.getUserPosition([
      buyer.account.address,
      config.deliveryDate,
    ]);
    assert.equal(posAfter.netQuantity, 1n, "one contract remains when IM==MM");
  });
});
