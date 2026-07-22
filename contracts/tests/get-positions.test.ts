import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";

const { networkHelpers } = await network.getOrCreate();

describe("Get Positions", () => {
  it("should get positions by participant and expiration date", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;

    const price = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    await collateralVault.write.deposit([price * 10n], { account: seller.account });
    await collateralVault.write.deposit([price * 10n], { account: buyer.account });
    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, 1n], { account: buyer.account });

    const sellerPos = await futures.read.getUserPosition([seller.account.address, deliveryDate]);
    const buyerPos = await futures.read.getUserPosition([buyer.account.address, deliveryDate]);

    assert.equal(sellerPos.netQuantity, -1n);
    assert.equal(buyerPos.netQuantity, 1n);
    assert.equal(sellerPos.netEntryValue, -price);
    assert.equal(buyerPos.netEntryValue, price);
  });

  it("returns netQuantity zero after the exiting participant offsets their position", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, owner } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 2n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.setTakerFee([0n], { account: owner.account });

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await collateralVault.write.deposit([margin], { account: buyer2.account });

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, 1n], { account: buyer.account });

    const buyerPosBefore = await futures.read.getUserPosition([buyer.account.address, deliveryDate]);
    assert.equal(buyerPosBefore.netQuantity, 1n);

    await futures.write.createOrder([price, deliveryDate, 1n], { account: buyer2.account });
    await futures.write.createOrder([price, deliveryDate, -1n], { account: buyer.account });

    const buyerPosAfter = await futures.read.getUserPosition([buyer.account.address, deliveryDate]);
    assert.equal(buyerPosAfter.netQuantity, 0n);
    assert.equal(buyerPosAfter.netEntryValue, 0n);

    const sellerPos = await futures.read.getUserPosition([seller.account.address, deliveryDate]);
    const buyer2Pos = await futures.read.getUserPosition([buyer2.account.address, deliveryDate]);
    assert.equal(sellerPos.netQuantity, -1n);
    assert.equal(buyer2Pos.netQuantity, 1n);
  });
});
