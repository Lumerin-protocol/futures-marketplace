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
    const margin = price * 2n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.setTakerFee([0n], { account: owner.account });

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });
    await collateralVault.write.deposit([margin], { account: partC.account });

    await futures.write.createOrder([price, deliveryDate, -1], { account: partA.account });
    await futures.write.createOrder([price, deliveryDate, 1], { account: partB.account });

    await futures.write.createOrder([price2, deliveryDate, -1], { account: partB.account });
    await futures.write.createOrder([price2, deliveryDate, 1], { account: partA.account });

    const partAPos = await futures.read.getUserPosition([partA.account.address, deliveryDate]);
    const partBPos = await futures.read.getUserPosition([partB.account.address, deliveryDate]);
    assert.equal(partAPos.netQuantity, 0n);
    assert.equal(partBPos.netQuantity, 0n);

    const expPartApnl = price - price2;
    const expPartBpnl = price2 - price;

    const partABalance = await collateralVault.read.balanceOf([partA.account.address]);
    const partBBalance = await collateralVault.read.balanceOf([partB.account.address]);

    const partADelta = partABalance - margin;
    const partBDelta = partBBalance - margin;
    assert.deepEqual([partADelta, partBDelta], [expPartApnl, expPartBpnl]);
  });

  it("offsets the new-order placer's existing opposite position when their order crosses a resting one", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller: partA, buyer: partB, buyer2: partC, owner } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 2n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.setTakerFee([0n], { account: owner.account });

    await collateralVault.write.deposit([margin], { account: partA.account });
    await collateralVault.write.deposit([margin], { account: partB.account });
    await collateralVault.write.deposit([margin], { account: partC.account });

    await futures.write.createOrder([price, deliveryDate, -1], { account: partA.account });
    await futures.write.createOrder([price, deliveryDate, 1], { account: partB.account });
    await futures.write.createOrder([price, deliveryDate, 1], { account: partC.account });
    await futures.write.createOrder([price, deliveryDate, -1], { account: partB.account });

    const partAPos = await futures.read.getUserPosition([partA.account.address, deliveryDate]);
    const partBPos = await futures.read.getUserPosition([partB.account.address, deliveryDate]);
    const partCPos = await futures.read.getUserPosition([partC.account.address, deliveryDate]);

    assert.equal(partBPos.netQuantity, 0n);
    assert.equal(partAPos.netQuantity, -1n);
    assert.equal(partCPos.netQuantity, 1n);

    const partADelta = await futures.read.getNetPositionDelta([partA.account.address]);
    const partBDelta = await futures.read.getNetPositionDelta([partB.account.address]);
    const partCDelta = await futures.read.getNetPositionDelta([partC.account.address]);
    assert.equal(partBDelta, 0n);
    assert.equal(partADelta, -partCDelta);
    assert.notEqual(partADelta, 0n);
  });
});
