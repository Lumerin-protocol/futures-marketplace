import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { quantizePrice, refreshHashprice } from "./utils.ts";

const { networkHelpers } = await network.getOrCreate();

// Regression tests for the portfolio-margin trackers consumed by
// `getNetPositionDelta` and `getFuturesUnrealizedPnl`.
//
// Both views read from `participantDeliveryDateNetDelta` and
// `participantDeliveryDateNetEntryValue`, which are mutated only on position
// CREATE (`_createPosition`) and position REMOVE (`_removePosition`). Every
// position-closing path must terminate in `_removePosition`, otherwise the
// trackers leak and downstream margin checks (PortfolioMarginEngine,
// `computePortfolioIM`, etc.) read stale values.
//
// These tests pin the invariant for the two close paths that flow through
// `_closeAndCashSettleDelivery`:
//   1. `closeDelivery` → `_closeAndCashSettleDeliveryAndPenalize`
//   2. `marginCall` → `_forceLiquidatePosition`
describe("Portfolio-margin trackers — net delta / unrealized PnL", () => {
  it("trackers stay consistent across closeDelivery → reopen at a new date", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, validator, tc, pc } = accounts;

    const margin = parseUnits("10000", 6);
    const deliveryDate = config.deliveryDates[0];
    const dst = "https://destination-url.com";
    const price = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    for (const w of [seller, buyer]) {
      await collateralVault.write.deposit([margin], { account: w.account });
    }

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const tx = await futures.write.createOrder([price, deliveryDate, dst, 1], {
      account: buyer.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    const [posCreated] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "LotCreated",
    });
    const positionId = posCreated.args.lotId;

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

    // Advance into delivery and close: this is the closeDelivery path that flows
    // through _closeAndCashSettleDeliveryAndPenalize → _closeAndCashSettleDelivery.
    await tc.setNextBlockTimestamp({
      timestamp: deliveryDate + BigInt(config.deliveryDurationSeconds) / 2n,
    });
    await refreshHashprice(hashrateOracle);
    await futures.write.closeDelivery([positionId, true], { account: validator.account });

    // Re-open one position at a *different* delivery date. If
    // _closeAndCashSettleDelivery had failed to decrement the original tracker
    // for `deliveryDate`, that mapping would still hold ±deliveryDurationDays.
    // Reopening at `laterDeliveryDate` adds another ±deliveryDurationDays. The
    // observable post-state is the *sum* of both — so a leak shows up as a
    // doubled magnitude.
    const laterDeliveryDate = config.deliveryDates[2];
    await futures.write.createOrder([price, laterDeliveryDate, "", -1], {
      account: seller.account,
    });
    const tx2 = await futures.write.createOrder([price, laterDeliveryDate, dst, 1], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: tx2 });

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

  it("trackers clear after marginCall liquidates a position pre-delivery", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, validator, pc, tc } = accounts;

    const deliveryDate = config.deliveryDates[0];
    const dst = "https://destination-url.com";
    const price = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    // Seller deposits exactly `entry × duration`: enough to enter, but a small
    // adverse move pushes them past the liquidation threshold.
    const sellerMargin = price * BigInt(config.deliveryDurationDays);
    const buyerMargin = parseUnits("5000", 6);
    await collateralVault.write.deposit([sellerMargin], { account: seller.account });
    await collateralVault.write.deposit([buyerMargin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: seller.account });
    const tx = await futures.write.createOrder([price, deliveryDate, dst, 1], {
      account: buyer.account,
    });
    await pc.waitForTransactionReceipt({ hash: tx });

    const sellerDeltaBefore = await futures.read.getNetPositionDelta([seller.account.address]);
    const buyerDeltaBefore = await futures.read.getNetPositionDelta([buyer.account.address]);
    assert.ok(sellerDeltaBefore < 0n, "seller is short");
    assert.ok(buyerDeltaBefore > 0n, "buyer is long");

    // Push the market price above the seller's entry so portfolio MM (PME)
    // exceeds their balance and `marginCall` actually liquidates. Cash settlement
    // still has to complete, so the move must remain bounded by the seller's
    // collateral.
    //
    // Seller short 1 contract over 7 days. PME stress MM ≈ mmSpot · spot · |Δ|/WAD
    // (≈ 0.05 · C · 7 = 0.35·C in token units), plus unrealized loss
    // (C − price) · 7. Balance ≈ 700. Solve 0.35·C + 7·(C − 100) > 700 ⇒ C > 190.
    // Pick C = 1.95 × price = 195 to clear the threshold with margin to spare.
    const targetMarketPrice = (price * 195n) / 100n;
    // market = hashpriceUsd / hashpriceScalingDivisor → hashpriceUsd = market × divisor.
    // hashpriceScalingDivisor = 10^(oracleDecimals − tokenDecimals) = 10^(8−6) = 100.
    await hashrateOracle.write.setPrice([targetMarketPrice * 100n]);
    await tc.mine({ blocks: 1 });

    await futures.write.marginCall([seller.account.address], { account: validator.account });

    // The position's delivery date is still in the future-iteration window of
    // `getNetPositionDelta`, so any tracker leak is directly observable.
    const sellerDeltaAfter = await futures.read.getNetPositionDelta([seller.account.address]);
    const buyerDeltaAfter = await futures.read.getNetPositionDelta([buyer.account.address]);
    const sellerPnlAfter = await futures.read.getFuturesUnrealizedPnl([seller.account.address]);
    const buyerPnlAfter = await futures.read.getFuturesUnrealizedPnl([buyer.account.address]);

    assert.equal(sellerDeltaAfter, 0n, "seller delta tracker cleared after liquidation");
    assert.equal(sellerPnlAfter, 0n, "seller PnL tracker cleared after liquidation");
    assert.equal(buyerDeltaAfter, 0n, "buyer delta tracker cleared after liquidation");
    assert.equal(buyerPnlAfter, 0n, "buyer PnL tracker cleared after liquidation");
  });
});
