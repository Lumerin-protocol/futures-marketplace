import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits, zeroHash } from "viem";
import type { NetworkConnection } from "hardhat/types/network";
import { deployFuturesFixture } from "./fixtures.ts";
import { scaleHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * `liquidatePositions(participant, ids[])` — batched close-to-IM liquidation.
 *
 * The contract does NOT recompute margin per lot: it closes the keeper-supplied
 * set (skipping stale/foreign ids), then reads margin ONCE at the end and
 * reverts `OverLiquidation` if positions remain AND `balance > IM` (with a real
 * IM > MM buffer). Fully-closed accounts skip that guard (bad-debt path). The
 * keeper is responsible for choosing the worst-first subset off-chain.
 *
 * Fixture shape (chosen so behaviour is robust to PME rounding):
 *   - PME shocks IM 20% / MM 10% → a genuine buffer (IM > MM).
 *   - 10 long lots for `buyer`, matched by `seller`.
 *   - Deposit ≈ 2.2·(entry·days·10)/10 — clears entry IM (2.0·u) so the
 *     position opens, but a 15% hashprice crash breaks MM (MM_req₀ ≈ 2.35·u).
 *   - After the crash: closing a FEW lots stays at/under IM (no revert),
 *     closing almost ALL lots overshoots IM (OverLiquidation), closing EVERY
 *     lot skips the guard.
 */
async function partialLiquidationFixture(conn: NetworkConnection) {
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
  await futures.write.setMakerFee([0n], { account: owner.account });
  await futures.write.setTakerFee([0n], { account: owner.account });

  const entry = await futures.read.getMarketPrice();
  const deliveryDate = config.deliveryDates[0];
  const days = BigInt(config.deliveryDurationDays);
  const lotCount = 10;

  // u = entry·days (per-lot notional). Deposit 2.2·u·(lotCount/10) = 2.2·u for
  // 10 lots. See header for why this lands underwater-but-partially-recoverable.
  const u = entry * days;
  const buyerDeposit = (u * 22n) / 10n;
  const bigDeposit = u * 100n;

  await collateralVault.write.deposit([buyerDeposit], { account: buyer.account });
  await collateralVault.write.deposit([bigDeposit], { account: seller.account });
  await collateralVault.write.deposit([bigDeposit], { account: buyer2.account });

  // Open 10 matched long lots for buyer (seller short).
  await futures.write.createOrder([entry, deliveryDate, "", -lotCount], {
    account: seller.account,
  });
  const matchTx = await futures.write.createOrder([entry, deliveryDate, "", lotCount], {
    account: buyer.account,
  });
  await pc.waitForTransactionReceipt({ hash: matchTx });

  // A foreign position (buyer2 long vs seller) — used to prove `liquidatePositions`
  // skips ids the target participant doesn't own.
  await futures.write.createOrder([entry, deliveryDate, "", -1], { account: seller.account });
  const foreignTx = await futures.write.createOrder([entry, deliveryDate, "", 1], {
    account: buyer2.account,
  });
  const foreignReceipt = await pc.waitForTransactionReceipt({ hash: foreignTx });
  const [foreignEvt] = parseEventLogs({
    logs: foreignReceipt.logs,
    abi: futures.abi,
    eventName: "LotCreated",
  });
  const foreignPositionId = foreignEvt.args.lotId;

  return {
    ...data,
    config: { ...config, entry, deliveryDate, days, lotCount },
    foreignPositionId,
    /** 15% hashprice crash — moderate: breaks MM but keeps a recoverable band. */
    async makeUnderwater() {
      await scaleHashprice(contracts.hashrateOracle, 85n, 100n);
    },
  };
}

describe("Futures - liquidatePositions (batched close-to-IM)", function () {
  it("reverts NotLiquidatable when the participant is healthy", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    const ids = await futures.read.getPositionIds([buyer.account.address]);
    assert.ok(ids.length > 0);

    // No crash — buyer remains healthy, so the batch entry point rejects.
    await viem.assertions.revertWithCustomError(
      futures.write.liquidatePositions([buyer.account.address, ids], {
        account: buyer2.account,
      }),
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
    await futures.write.createOrder([config.entry / 2n, config.deliveryDate, "", 1], {
      account: buyer.account,
    });

    await data.makeUnderwater();

    const ids = await futures.read.getPositionIds([buyer.account.address]);
    await viem.assertions.revertWithCustomError(
      futures.write.liquidatePositions([buyer.account.address, ids], {
        account: buyer2.account,
      }),
      futures,
      "OrdersStillOpen",
    );
  });

  it("closes the supplied subset in one call and pays no over-liquidation", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts } = data;
    const { futures } = contracts;
    const { buyer, buyer2, pc } = accounts;

    await data.makeUnderwater();

    const idsBefore = await futures.read.getPositionIds([buyer.account.address]);
    // Close a small subset (2 lots) — stays at/under IM, so no OverLiquidation.
    const subset = idsBefore.slice(0, 2);

    const tx = await futures.write.liquidatePositions([buyer.account.address, subset], {
      account: buyer2.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    // Exactly the supplied lots closed; the rest stay open.
    const idsAfter = await futures.read.getPositionIds([buyer.account.address]);
    assert.equal(idsAfter.length, idsBefore.length - subset.length);
    for (const id of subset) {
      assert.ok(!idsAfter.includes(id), `lot ${id} should be closed`);
    }

    // One LotLiquidated per closed lot, all in this single tx.
    const liquidated = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotLiquidated",
    });
    assert.equal(liquidated.length, subset.length);
  });

  it("skips stale (unknown) and foreign ids but still closes the owned ones", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, foreignPositionId } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    await data.makeUnderwater();

    const owned = await futures.read.getPositionIds([buyer.account.address]);
    // Interleave a non-existent id and a foreign (buyer2-owned) id with two
    // owned ids. The batch must skip the first two and close the owned pair.
    const supplied = [owned[0], zeroHash, foreignPositionId, owned[1]] as const;

    await futures.write.liquidatePositions([buyer.account.address, supplied], {
      account: buyer2.account,
    });

    const after = await futures.read.getPositionIds([buyer.account.address]);
    assert.equal(after.length, owned.length - 2, "only the two owned ids should close");
    assert.ok(!after.includes(owned[0]));
    assert.ok(!after.includes(owned[1]));
    // The foreign position is untouched.
    const foreign = await futures.read.getPositionById([foreignPositionId]);
    assert.notEqual(foreign.seller, "0x0000000000000000000000000000000000000000");
  });

  it("reverts NotLiquidatable when nothing in the supplied set could be closed", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, foreignPositionId } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    await data.makeUnderwater();

    // Underwater, but every supplied id is stale/foreign → closed == 0.
    await viem.assertions.revertWithCustomError(
      futures.write.liquidatePositions(
        [buyer.account.address, [zeroHash, foreignPositionId]],
        { account: buyer2.account },
      ),
      futures,
      "NotLiquidatable",
    );
  });

  it("reverts OverLiquidation when the supplied set closes past the IM buffer", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    await data.makeUnderwater();

    const ids = await futures.read.getPositionIds([buyer.account.address]);
    // Close all-but-one — that overshoots IM (balance of the single remaining
    // lot far exceeds its IM requirement), so the end-of-batch guard reverts.
    const tooMany = ids.slice(0, ids.length - 1);

    await viem.assertions.revertWithCustomError(
      futures.write.liquidatePositions([buyer.account.address, tooMany], {
        account: buyer2.account,
      }),
      futures,
      "OverLiquidation",
    );
  });

  it("skips the over-liquidation guard on a full close (all lots gone)", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts } = data;
    const { futures } = contracts;
    const { buyer, buyer2 } = accounts;

    await data.makeUnderwater();

    const ids = await futures.read.getPositionIds([buyer.account.address]);
    // Closing EVERY lot leaves no positions, so the guard is skipped even
    // though the residual balance sits above (a now-zero) IM.
    await futures.write.liquidatePositions([buyer.account.address, ids], {
      account: buyer2.account,
    });

    const after = await futures.read.getPositionIds([buyer.account.address]);
    assert.equal(after.length, 0, "all supplied lots should be closed");
  });

  it("records BadDebt when the loser can't cover; insurance fund makes the winner whole", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, buyer2, pc } = accounts;

    // Deep 99% hashprice crash (vs the fixture's moderate 15%): the long buyer's
    // realized loss on a full close dwarfs their ~$53 deposit, so their
    // collateral cannot cover it and the uncovered remainder is absorbed by the
    // protocol's insurance fund (NOT taken from other users' balances). The
    // $10,000 insurance fund still comfortably covers the winning seller's
    // profit (~$238), so every BadDebt event is attributable to the buyer.
    await scaleHashprice(hashrateOracle, 1n, 100n);

    // Both legs matched at `config.entry`, so each closed lot's seller PnL is
    // (entry − mark)·days; the buyer's loss is the exact negative of that.
    const marketAfter = await futures.read.getMarketPrice();
    const totalSellerPnl = (config.entry - marketAfter) * config.days * BigInt(config.lotCount);

    const ids = await futures.read.getPositionIds([buyer.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const insuranceAddr = await collateralVault.read.INSURANCE_FUND_ADDR();
    const insuranceBefore = await collateralVault.read.balanceOf([insuranceAddr]);

    // Full close (all lots) → the over-liquidation guard is skipped (bad-debt path).
    const tx = await futures.write.liquidatePositions([buyer.account.address, ids], {
      account: buyer2.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    // Buyer is fully flattened.
    const idsAfter = await futures.read.getPositionIds([buyer.account.address]);
    assert.equal(idsAfter.length, 0, "buyer fully closed");

    // BadDebt fired, attributed to the insolvent buyer, and the recorded total
    // equals exactly the loss beyond the buyer's collateral.
    const badDebt = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "BadDebt" });
    assert.ok(badDebt.length >= 1, "expected at least one BadDebt event on the uncovered loss");
    let uncovered = 0n;
    for (const evt of badDebt) {
      assert.equal(
        getAddress(evt.args.account),
        getAddress(buyer.account.address),
        "BadDebt should be attributed to the insolvent buyer",
      );
      uncovered += evt.args.amount;
    }
    const expectedShortfall = totalSellerPnl - buyerBalanceBefore;
    assert.equal(
      uncovered,
      expectedShortfall,
      "BadDebt amount == the portion of the loss the buyer's collateral couldn't cover",
    );

    // The buyer's collateral is drained to zero (never negative).
    const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    assert.equal(buyerBalanceAfter, 0n, "buyer collateral fully drained");

    // The winning seller is made whole from the insurance fund.
    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    assert.equal(
      sellerBalanceAfter - sellerBalanceBefore,
      totalSellerPnl,
      "winning seller paid the full profit",
    );

    // Net effect on the fund: it received the buyer's available collateral and
    // paid the seller's full profit → down by exactly the uncovered shortfall.
    const insuranceAfter = await collateralVault.read.balanceOf([insuranceAddr]);
    assert.equal(
      insuranceBefore - insuranceAfter,
      expectedShortfall,
      "insurance fund absorbed exactly the uncovered shortfall",
    );
  });

  it("degenerate IM <= MM: no upper-bound revert even when over-closing", async function () {
    const data = await networkHelpers.loadFixture(partialLiquidationFixture);
    const { contracts, accounts } = data;
    const { futures, portfolioMarginEngine } = contracts;
    const { buyer, buyer2, owner } = accounts;

    // Collapse the buffer: IM == MM. The guard's `im > mm` precondition is
    // false, so there's no over-liquidation ceiling.
    const shock = parseUnits("0.10", 18);
    await portfolioMarginEngine.write.setShocks([shock, shock, 0n, 0n], {
      account: owner.account,
    });

    await data.makeUnderwater();

    const ids = await futures.read.getPositionIds([buyer.account.address]);
    const tooMany = ids.slice(0, ids.length - 1);

    // Same "close all-but-one" that reverted under IM>MM now succeeds.
    await futures.write.liquidatePositions([buyer.account.address, tooMany], {
      account: buyer2.account,
    });

    const after = await futures.read.getPositionIds([buyer.account.address]);
    assert.equal(after.length, 1, "one lot remains, no OverLiquidation revert");
  });
});
