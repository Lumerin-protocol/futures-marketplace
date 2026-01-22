import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { encodeAbiParameters, keccak256 } from "viem";
import { deployFuturesFixture } from "./fixtures";
import { catchError } from "../lib/lib";

describe("Fees", function () {
  it("should collect order fee on order creation", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.addMargin([margin], { account: seller.account });

    const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    expect(feesAfter - feesBefore).to.equal(config.orderFee);
    expect(sellerBalanceBefore - sellerBalanceAfter).to.equal(config.orderFee);
  });

  it("should allow only owner to withdraw collected fees", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    await catchError(futures.abi, "OwnableUnauthorizedAccount", async () => {
      await futures.write.withdrawCollectedFees({ account: seller.account });
    });
  });

  it("should withdraw correct amount of fees", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures, usdcMock } = contracts;
    const { owner, seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.addMargin([margin], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    const feesAccrued = await futures.read.collectedFeesBalance();
    expect(feesAccrued).to.equal(config.orderFee);

    const ownerBalanceBefore = await usdcMock.read.balanceOf([owner.account.address]);
    const contractBalanceBefore = await usdcMock.read.balanceOf([futures.address]);

    await futures.write.withdrawCollectedFees({ account: owner.account });

    const ownerBalanceAfter = await usdcMock.read.balanceOf([owner.account.address]);
    const contractBalanceAfter = await usdcMock.read.balanceOf([futures.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    expect(feesAfter).to.equal(0n);
    expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(feesAccrued);
    expect(contractBalanceBefore - contractBalanceAfter).to.equal(feesAccrued);
  });

  it("should collect correct fee per address discount", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner, seller, buyer } = accounts;

    const discountPercent = 50;
    await futures.write.setFeeDiscountPercent([seller.account.address, discountPercent], {
      account: owner.account,
    });

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.addMargin([margin], { account: seller.account });
    await futures.write.addMargin([margin], { account: buyer.account });

    const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await futures.read.balanceOf([buyer.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, "", 1], { account: buyer.account });

    const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);
    const buyerBalanceAfter = await futures.read.balanceOf([buyer.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    const discountedFee = config.orderFee - (config.orderFee * BigInt(discountPercent)) / 100n;
    const expectedFees = discountedFee + config.orderFee;

    expect(feesAfter - feesBefore).to.equal(expectedFees);
    expect(sellerBalanceBefore - sellerBalanceAfter).to.equal(discountedFee);
    expect(buyerBalanceBefore - buyerBalanceAfter).to.equal(config.orderFee);
  });

  it("should collect full fee for 0 percent discount", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner, seller } = accounts;

    const discountPercent = 0;
    await futures.write.setFeeDiscountPercent([seller.account.address, discountPercent], {
      account: owner.account,
    });

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.addMargin([margin], { account: seller.account });

    const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    expect(feesAfter - feesBefore).to.equal(config.orderFee);
    expect(sellerBalanceBefore - sellerBalanceAfter).to.equal(config.orderFee);
  });

  it("should collect zero fee for 100 percent discount", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner, seller } = accounts;

    const discountPercent = 100;
    await futures.write.setFeeDiscountPercent([seller.account.address, discountPercent], {
      account: owner.account,
    });

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await futures.write.addMargin([margin], { account: seller.account });

    const sellerBalanceBefore = await futures.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, "", 1], { account: seller.account });

    const sellerBalanceAfter = await futures.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    expect(feesAfter - feesBefore).to.equal(0n);
    expect(sellerBalanceBefore - sellerBalanceAfter).to.equal(0n);
  });
});
