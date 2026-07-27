import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { quantizePrice, refreshHashprice } from "./utils.ts";

const { networkHelpers } = await network.getOrCreate();

// Regression tests for the portfolio-margin trackers consumed by
// `getNetPositionDelta` and `getUnrealizedPnl`.
//
// Both views read from `participantExpirationAtNetDelta` and
// `participantExpirationAtNetEntryValue`, which are mutated on position
// CREATE and position REMOVE / partial close. Every position-closing path must
// update the trackers correctly, otherwise downstream margin checks
// (PortfolioMarginEngine, `computePortfolioIM`, etc.) read stale values.
//
// These tests pin the invariant for the two close paths that flow through
// `_settleAtMark`:
//   1. `settlePosition` (cash settlement at maturity)
//   2. `liquidatePosition` → partial / full aggregate close
describe("Portfolio-margin trackers — net delta / unrealized PnL", () => {
  it("trackers stay consistent across settlePosition → reopen at a new date", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { seller, buyer, validator, tc } = accounts;

    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const price = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    for (const w of [seller, buyer]) {
      await collateralVault.write.deposit([margin], { account: w.account });
    }

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, 1n], {
      account: buyer.account,
    });

    const sellerDeltaSinglePosition = await futures.read.getNetPositionDelta([
      seller.account.address,
    ]);
    const buyerDeltaSinglePosition = await futures.read.getNetPositionDelta([
      buyer.account.address,
    ]);
    assert.ok(sellerDeltaSinglePosition < 0n, "seller is short → negative delta");
    assert.ok(buyerDeltaSinglePosition > 0n, "buyer is long → positive delta");
    assert.equal(
      sellerDeltaSinglePosition,
      -buyerDeltaSinglePosition,
      "seller and buyer deltas mirror each other",
    );

    // Advance to maturity and cash-settle: this is the permissionless settlePosition
    // path that flows through _settleAtMark → _removePosition.
    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(config.expirationIntervalSeconds) / 2n,
    });
    await refreshHashprice(hashpriceUsd);
    await futures.write.settlePosition([seller.account.address, deliveryDate], {
      account: validator.account,
    });

    // Re-open one position at a *different* expiration date. If
    // _settleAtMark had failed to decrement the original tracker
    // for `deliveryDate`, that mapping would still hold ±1 per contract.
    // Reopening at `laterDeliveryDate` adds another ±1. The observable
    // post-state is the *sum* of both — so a leak shows up as a doubled
    // magnitude.
    const laterDeliveryDate = config.deliveryDates[2];
    await futures.write.createOrder([price, laterDeliveryDate, -1n], {
      account: seller.account,
    });
    await futures.write.createOrder([price, laterDeliveryDate, 1n], {
      account: buyer.account,
    });

    const sellerDeltaAfterReopen = await futures.read.getNetPositionDelta([
      seller.account.address,
    ]);
    const buyerDeltaAfterReopen = await futures.read.getNetPositionDelta([buyer.account.address]);

    assert.equal(
      sellerDeltaAfterReopen,
      sellerDeltaSinglePosition,
      "seller delta after close+reopen at different date matches a single short — no tracker leak",
    );
    assert.equal(
      buyerDeltaAfterReopen,
      buyerDeltaSinglePosition,
      "buyer delta after close+reopen at different date matches a single long — no tracker leak",
    );
  });

  it("trackers clear after permissionless liquidatePosition pre-delivery", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { seller, buyer, tc, owner } = accounts;

    const deliveryDate = config.deliveryDates[0];
    const price = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    // Seller deposits roughly one contract's entry value: enough to enter, but a
    // small adverse move pushes them past the liquidation threshold.
    const sellerMargin = price;
    const buyerMargin = parseUnits("5000", 6);
    await collateralVault.write.deposit([sellerMargin], { account: seller.account });
    await collateralVault.write.deposit([buyerMargin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, 1n], {
      account: buyer.account,
    });

    const sellerDeltaBefore = await futures.read.getNetPositionDelta([seller.account.address]);
    const buyerDeltaBefore = await futures.read.getNetPositionDelta([buyer.account.address]);
    assert.ok(sellerDeltaBefore < 0n, "seller is short");
    assert.ok(buyerDeltaBefore > 0n, "buyer is long");

    // Push the market price above the seller's entry so portfolio MM (PME)
    // exceeds their balance and `liquidatePosition` actually liquidates. Cash
    // settlement still has to complete, so the move must remain bounded by the
    // seller's collateral.
    //
    // Seller short 1 contract (no duration multiplier). PME stress MM ≈
    // mmShock · spot · |Δ|/WAD (0.20·C) plus unrealized loss (C − price).
    // Balance ≈ 100. Solve 0.20·C + (C − 100) > 100 ⇒ C > 166.
    // Pick C = 1.95 × price = 195 to clear the threshold with margin to spare.
    const targetMarketPrice = (price * 195n) / 100n;
    // market = hashpriceUsd / hashpriceScalingDivisor (oracle already quotes 1 PH/s·day).
    // divisor = 10^(oracleDecimals − tokenDecimals) = 10^(8−6) = 100
    // ⇒ hashpriceUsd = market × 100.
    const divisor = await futures.read.hashpriceScalingDivisor();
    await hashpriceUsd.write.setPrice([targetMarketPrice * divisor], {
      account: owner.account,
      chain: owner.chain,
    });
    await tc.mine({ blocks: 1 });

    await futures.write.liquidatePosition([seller.account.address, deliveryDate, 1n]);

    // The position's expiration date is still in the future-iteration window of
    // `getNetPositionDelta`, so any tracker leak is directly observable.
    const sellerDeltaAfter = await futures.read.getNetPositionDelta([seller.account.address]);
    const buyerDeltaAfter = await futures.read.getNetPositionDelta([buyer.account.address]);
    const sellerPnlAfter = await futures.read.getUnrealizedPnl([seller.account.address]);
    const buyerPnlAfter = await futures.read.getUnrealizedPnl([buyer.account.address]);

    assert.equal(sellerDeltaAfter, 0n, "seller delta tracker cleared after liquidation");
    assert.equal(sellerPnlAfter, 0n, "seller PnL tracker cleared after liquidation");
    // Unilateral liquidation: buyer's aggregate remains open.
    assert.equal(buyerDeltaAfter, buyerDeltaBefore, "buyer delta unchanged after seller liquidation");
    assert.ok(buyerPnlAfter !== 0n, "buyer still has unrealized PnL on the open long");
  });
});
