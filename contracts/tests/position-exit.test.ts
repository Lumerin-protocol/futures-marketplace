import { it, describe } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";

const { networkHelpers } = await network.getOrCreate();

describe("Position Exit", () => {
  it("should handle exiting positions from both parties at the same time", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller: partA, buyer: partB, buyer2: partC, owner } = accounts;

    const price = await futures.read.getMarketPrice();
    const price2 = price - config.priceLadderStep;
    const margin = price * BigInt(config.deliveryDurationDays) * 2n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.setOrderFee([0n], { account: owner.account });

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });
    await collateralVault.write.deposit([margin], { account: partC.account });

    // Step 1: A sells and B buys at price, creating initial positions
    //   - A is short (owes delivery)
    //   - B is long (expects delivery)
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partA.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: partB.account });

    // Step 2: Both parties want to exit, so they place opposite orders at price2
    //   - A places a buy order to close short
    //   - B places a sell order to close long
    //   - Orders match, offsetting both positions
    await futures.write.createOrder([price2, deliveryDate, "", -1], { account: partB.account });
    await futures.write.createOrder([price2, deliveryDate, "", 1], { account: partA.account });

    const partAPositions = await futures.read.getPositionsByParticipantDeliveryDate([
      partA.account.address,
      deliveryDate,
    ]);
    assert.equal(partAPositions.length, 0);
    const partBPositions = await futures.read.getPositionsByParticipantDeliveryDate([
      partB.account.address,
      deliveryDate,
    ]);
    assert.equal(partBPositions.length, 0);

    const expPartApnl = (price - price2) * BigInt(config.deliveryDurationDays);
    const expPartBpnl = (price2 - price) * BigInt(config.deliveryDurationDays);

    const partABalance = await collateralVault.read.balanceOf([partA.account.address]);
    const partBBalance = await collateralVault.read.balanceOf([partB.account.address]);

    const partADelta = partABalance - margin;
    const partBDelta = partBBalance - margin;
    assert.deepEqual([partADelta, partBDelta], [expPartApnl, expPartBpnl]);
  });

  it("offsets the new-order placer's existing opposite position when their order crosses a resting one", async () => {
    // Reproduces a bug where the offset logic in `_createPosition` only checked the
    // resting-order placer's existing positions, never the new market-order placer's.
    //
    // Scenario:
    //   1. A sells, B buys → P1 (seller=A, buyer=B). B is now long.
    //   2. C places a *resting* buy order at the same price/date.
    //   3. B places a sell order that immediately matches C's resting buy.
    //
    // Expected: B's existing long is offset and removed. The remaining short obligation
    // (A) is rewired to face C as the new buyer — i.e. one position (A short, C long).
    // Bug: B was left holding both the original long (vs A) AND a new short (vs C).
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller: partA, buyer: partB, buyer2: partC, owner } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * BigInt(config.deliveryDurationDays) * 2n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.setOrderFee([0n], { account: owner.account });

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });
    await collateralVault.write.deposit([margin], { account: partC.account });

    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partA.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: partB.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: partC.account });
    await futures.write.createOrder([price, deliveryDate, "", -1], { account: partB.account });

    const partAPositions = await futures.read.getPositionsByParticipantDeliveryDate([
      partA.account.address,
      deliveryDate,
    ]);
    const partBPositions = await futures.read.getPositionsByParticipantDeliveryDate([
      partB.account.address,
      deliveryDate,
    ]);
    const partCPositions = await futures.read.getPositionsByParticipantDeliveryDate([
      partC.account.address,
      deliveryDate,
    ]);
    assert.equal(partBPositions.length, 0, "B should be flat after offsetting their long");
    assert.equal(partAPositions.length, 1, "A should still hold one short position");
    assert.equal(partCPositions.length, 1, "C should hold one long position");
    assert.equal(partAPositions[0], partCPositions[0], "A and C should share the same position");

    const partADelta = await futures.read.getNetPositionDelta([partA.account.address]);
    const partBDelta = await futures.read.getNetPositionDelta([partB.account.address]);
    const partCDelta = await futures.read.getNetPositionDelta([partC.account.address]);
    assert.equal(partBDelta, 0n, "B net delta should be zero");
    assert.equal(partADelta, -partCDelta, "A and C should hold opposite deltas");
    assert.notEqual(partADelta, 0n, "A should be net short");
  });
});
