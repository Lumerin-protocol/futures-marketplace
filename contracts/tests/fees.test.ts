import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Fees", () => {
  it("should collect order fee on order creation", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(feesAfter - feesBefore, config.orderFee);
    assert.equal(sellerBalanceBefore - sellerBalanceAfter, config.orderFee);
  });

  it("should allow only owner to withdraw collected fees", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.withdrawCollectedFees({ account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
  });

  it("should withdraw correct amount of fees", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, usdcMock, collateralVault } = contracts;
    const { owner, seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    const feesAccrued = await futures.read.collectedFeesBalance();
    assert.equal(feesAccrued, config.orderFee);

    const ownerBalanceBefore = await usdcMock.read.balanceOf([owner.account.address]);

    await futures.write.withdrawCollectedFees({ account: owner.account });

    const ownerBalanceAfter = await usdcMock.read.balanceOf([owner.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(feesAfter, 0n);
    assert.equal(ownerBalanceAfter - ownerBalanceBefore, feesAccrued);
  });

  it("should collect correct fee per address discount", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    const discountPercent = 50;
    await futures.write.setFeeDiscountPercent([seller.account.address, discountPercent], {
      account: owner.account,
    });

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: buyer.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    const discountedFee = config.orderFee - (config.orderFee * BigInt(discountPercent)) / 100n;
    const expectedFees = discountedFee + config.orderFee;

    assert.equal(feesAfter - feesBefore, expectedFees);
    assert.equal(sellerBalanceBefore - sellerBalanceAfter, discountedFee);
    assert.equal(buyerBalanceBefore - buyerBalanceAfter, config.orderFee);
  });

  it("should collect full fee for 0 percent discount", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller } = accounts;

    await futures.write.setFeeDiscountPercent([seller.account.address, 0], {
      account: owner.account,
    });

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(feesAfter - feesBefore, config.orderFee);
    assert.equal(sellerBalanceBefore - sellerBalanceAfter, config.orderFee);
  });

  it("should collect zero fee for 100 percent discount", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller } = accounts;

    await futures.write.setFeeDiscountPercent([seller.account.address, 100], {
      account: owner.account,
    });

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(feesAfter - feesBefore, 0n);
    assert.equal(sellerBalanceBefore - sellerBalanceAfter, 0n);
  });
});
