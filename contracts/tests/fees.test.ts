import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const USDC_DECIMALS = 6;

describe("Fees (maker/taker)", () => {
  it("should NOT charge fees on a plain resting order", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, 1], { account: seller.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(feesAfter - feesBefore, 0n);
    assert.equal(sellerBalanceAfter, sellerBalanceBefore);
  });

  it("should charge taker on fill and not the maker when makerFee is 0", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, 1], { account: buyer.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(sellerBalanceAfter, sellerBalanceBefore); // maker pays makerFee=0
    assert.equal(buyerBalanceBefore - buyerBalanceAfter, config.takerFee);
    assert.equal(feesAfter - feesBefore, config.takerFee);
  });

  it("should charge both maker and taker on a fill when both fees are set", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    const customMakerFee = parseUnits("0.5", USDC_DECIMALS);
    await futures.write.setMakerFee([customMakerFee], { account: owner.account });

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, 1], { account: buyer.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(sellerBalanceBefore - sellerBalanceAfter, customMakerFee);
    assert.equal(buyerBalanceBefore - buyerBalanceAfter, config.takerFee);
    assert.equal(feesAfter - feesBefore, customMakerFee + config.takerFee);
  });

  it("should NOT charge fees when a participant self-cancels via opposite-side qty", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    await futures.write.createOrder([price, deliveryDate, 1], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, -1], { account: seller.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(sellerBalanceAfter, sellerBalanceBefore);
    assert.equal(feesAfter, feesBefore);
  });

  it("emits ConfigUpdated carrying maker/taker fees when fees are set", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner, pc } = accounts;

    const newMakerFee = parseUnits("2", USDC_DECIMALS);
    const newTakerFee = parseUnits("3", USDC_DECIMALS);

    const makerTx = await futures.write.setMakerFee([newMakerFee], { account: owner.account });
    const makerReceipt = await pc.waitForTransactionReceipt({ hash: makerTx });
    const [makerEvent] = parseEventLogs({
      logs: makerReceipt.logs,
      abi: futures.abi,
      eventName: "ConfigUpdated",
    });
    assert.equal(makerEvent.args.config.makerFee, newMakerFee);

    const takerTx = await futures.write.setTakerFee([newTakerFee], { account: owner.account });
    const takerReceipt = await pc.waitForTransactionReceipt({ hash: takerTx });
    const [takerEvent] = parseEventLogs({
      logs: takerReceipt.logs,
      abi: futures.abi,
      eventName: "ConfigUpdated",
    });
    assert.equal(takerEvent.args.config.takerFee, newTakerFee);
    // The snapshot is always whole-config, so the previously-set maker fee is still present.
    assert.equal(takerEvent.args.config.makerFee, newMakerFee);

    assert.equal(await futures.read.makerFee(), newMakerFee);
    assert.equal(await futures.read.takerFee(), newTakerFee);
  });

  it("should reject non-owner attempts to set maker/taker fees", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.setMakerFee([1n], { account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.setTakerFee([1n], { account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
  });

  it("should allow only owner to withdraw collected fees", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.withdrawCollectedFees({ account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
  });

  it("should withdraw the correct amount of accrued fees", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, usdcMock, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, 1], { account: buyer.account });

    const feesAccrued = await futures.read.collectedFeesBalance();
    assert.equal(feesAccrued, config.takerFee); // makerFee=0, takerFee charged once

    const ownerBalanceBefore = await usdcMock.read.balanceOf([owner.account.address]);
    await futures.write.withdrawCollectedFees({ account: owner.account });
    const ownerBalanceAfter = await usdcMock.read.balanceOf([owner.account.address]);

    assert.equal(await futures.read.collectedFeesBalance(), 0n);
    assert.equal(ownerBalanceAfter - ownerBalanceBefore, feesAccrued);
  });
});
