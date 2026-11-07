import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { networkHelpers } = await network.getOrCreate();

/** Delta units per contract in `getRiskView` (10^collateralDecimals). */
const DELTA_PER_CONTRACT = 10n ** 6n;

/**
 * N24: the engine stresses exposure at each venue's mark. Futures reports its live positions and
 * resting orders valued at the mark through `getExposureView`; the deprecated `getRiskView` keeps
 * reporting them in contracts.
 */
describe("N24 — futures reports exposure at its mark", () => {
  it("values the position and the resting orders at the mark, other fields as getRiskView", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = data.contracts;
    const { seller, buyer } = data.accounts;
    const [first, second] = data.config.deliveryDates;

    const mark = await futures.read.getMarketPrice();
    const step = await futures.read.minimumPriceIncrement();
    await collateralVault.write.deposit([mark * 20n], { account: seller.account });
    await collateralVault.write.deposit([mark * 20n], { account: buyer.account });

    // Buyer: long 3 on the first date, a bid for 2 and an ask for 1 resting on the second.
    await futures.write.createOrder([mark, first, -3n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([mark, first, 3n, TimeInForce.GTC], { account: buyer.account });
    await futures.write.createOrder([mark - step, second, 2n, TimeInForce.GTC], { account: buyer.account });
    await futures.write.createOrder([mark + step, second, -1n, TimeInForce.GTC], { account: buyer.account });

    const user = buyer.account.address;
    const risk = await futures.read.getRiskView([user]);
    const exposure = await futures.read.getExposureView([user]);

    assert.equal(risk.netPositionDelta, 3n * DELTA_PER_CONTRACT);
    assert.equal(exposure.netPositionExposure, 3n * mark);
    assert.equal(exposure.buyOrderExposure, 2n * mark);
    assert.equal(exposure.sellOrderExposure, 1n * mark);
    assert.equal(exposure.unrealizedPnl, risk.unrealizedPnl);
    assert.equal(exposure.pendingFunding, risk.pendingFunding);
    assert.equal(exposure.buyOrderFillLoss, risk.buyOrderFillLoss);
    assert.equal(exposure.sellOrderFillLoss, risk.sellOrderFillLoss);
  });

  it("reports nothing for an account with no position or order", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const exposure = await data.contracts.futures.read.getExposureView([data.accounts.buyer.account.address]);
    assert.equal(exposure.netPositionExposure, 0n);
    assert.equal(exposure.buyOrderExposure, 0n);
    assert.equal(exposure.sellOrderExposure, 0n);
  });
});
