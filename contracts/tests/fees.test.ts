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

    await futures.write.createOrder([price, deliveryDate, 1n], { account: seller.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(feesAfter - feesBefore, 0n);
    assert.equal(sellerBalanceAfter, sellerBalanceBefore);
  });

  it("should charge taker on fill and not the maker when makerFee is 0", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    const takerFeeBps = 500; // 5% for a visible balance change
    await futures.write.setTakerFeeBps([takerFeeBps], { account: owner.account });

    const price = await futures.read.getMarketPrice();
    const notional = price * 1n;
    const expectedFee = notional * BigInt(takerFeeBps) / 10_000n;
    const margin = price * 10n + expectedFee;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, 1n], { account: buyer.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(sellerBalanceAfter, sellerBalanceBefore); // maker pays makerFee=0
    assert.equal(buyerBalanceBefore - buyerBalanceAfter, expectedFee);
    assert.equal(feesAfter - feesBefore, expectedFee);
  });

  it("should charge both maker and taker on a fill when both fees are set", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    const makerFeeBps = 300; // 3%
    const takerFeeBps = 500; // 5%
    await futures.write.setMakerFeeBps([makerFeeBps], { account: owner.account });
    await futures.write.setTakerFeeBps([takerFeeBps], { account: owner.account });

    const price = await futures.read.getMarketPrice();
    const notional = price * 1n;
    const expectedMakerFee = notional * BigInt(makerFeeBps) / 10_000n;
    const expectedTakerFee = notional * BigInt(takerFeeBps) / 10_000n;
    const margin = price * 10n + expectedMakerFee + expectedTakerFee;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceBefore = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, 1n], { account: buyer.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBalanceAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(sellerBalanceBefore - sellerBalanceAfter, expectedMakerFee);
    assert.equal(buyerBalanceBefore - buyerBalanceAfter, expectedTakerFee);
    assert.equal(feesAfter - feesBefore, expectedMakerFee + expectedTakerFee);
  });

  it("should NOT charge fees when a participant self-cancels via opposite-side qty", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });

    await futures.write.createOrder([price, deliveryDate, 1n], { account: seller.account });

    const sellerBalanceBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const feesBefore = await futures.read.collectedFeesBalance();

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });

    const sellerBalanceAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const feesAfter = await futures.read.collectedFeesBalance();

    assert.equal(sellerBalanceAfter, sellerBalanceBefore);
    assert.equal(feesAfter, feesBefore);
  });

  it("emits MakerFeeBpsUpdated / TakerFeeBpsUpdated when fees are set", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner, pc } = accounts;

    const makerTx = await futures.write.setMakerFeeBps([50], { account: owner.account });
    const makerReceipt = await pc.waitForTransactionReceipt({ hash: makerTx });
    const [makerEvent] = parseEventLogs({
      logs: makerReceipt.logs,
      abi: futures.abi,
      eventName: "MakerFeeBpsUpdated",
    });
    assert.equal(makerEvent.args.newMakerFeeBps, 50);

    const takerTx = await futures.write.setTakerFeeBps([30], { account: owner.account });
    const takerReceipt = await pc.waitForTransactionReceipt({ hash: takerTx });
    const [takerEvent] = parseEventLogs({
      logs: takerReceipt.logs,
      abi: futures.abi,
      eventName: "TakerFeeBpsUpdated",
    });
    assert.equal(takerEvent.args.newTakerFeeBps, 30);

    assert.equal(await futures.read.makerFeeBps(), 50);
    assert.equal(await futures.read.takerFeeBps(), 30);
  });

  it("should reject non-owner attempts to set maker/taker fees", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.setMakerFeeBps([50], { account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.setTakerFeeBps([30], { account: seller.account }),
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

    const takerFeeBps = 500; // 5%
    await futures.write.setTakerFeeBps([takerFeeBps], { account: owner.account });

    const price = await futures.read.getMarketPrice();
    const notional = price * 1n;
    const expectedFee = notional * BigInt(takerFeeBps) / 10_000n;
    const margin = price * 10n + expectedFee;
    const deliveryDate = config.deliveryDates[0];

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });

    await futures.write.createOrder([price, deliveryDate, -1n], { account: seller.account });
    await futures.write.createOrder([price, deliveryDate, 1n], { account: buyer.account });

    const feesAccrued = await futures.read.collectedFeesBalance();
    assert.equal(feesAccrued, expectedFee);

    const ownerBalanceBefore = await usdcMock.read.balanceOf([owner.account.address]);
    await futures.write.withdrawCollectedFees({ account: owner.account });
    const ownerBalanceAfter = await usdcMock.read.balanceOf([owner.account.address]);

    assert.equal(await futures.read.collectedFeesBalance(), 0n);
    assert.equal(ownerBalanceAfter - ownerBalanceBefore, feesAccrued);
  });
});
