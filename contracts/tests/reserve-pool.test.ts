import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Reserve Pool", () => {
  it("should not allow withdrawal of more than the insurance fund balance", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { collateralVault } = contracts;
    const { owner } = accounts;

    const balance = await collateralVault.read.insuranceFundBalance();

    await viem.assertions.revertWithCustomError(
      collateralVault.write.withdrawInsuranceFund([owner.account.address, balance + 1n], {
        account: owner.account,
      }),
      collateralVault,
      "ERC20InsufficientBalance",
    );
  });

  it("should increase insurance fund balance when deposited", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { collateralVault, usdcMock } = contracts;
    const { owner } = accounts;

    const balanceBefore = await collateralVault.read.insuranceFundBalance();
    const ownerUsdcBefore = await usdcMock.read.balanceOf([owner.account.address]);

    await collateralVault.write.depositInsuranceFund([config.collateralAmount], {
      account: owner.account,
    });

    const balanceAfter = await collateralVault.read.insuranceFundBalance();
    const ownerUsdcAfter = await usdcMock.read.balanceOf([owner.account.address]);

    assert.equal(balanceAfter - balanceBefore, config.collateralAmount);
    assert.equal(ownerUsdcBefore - ownerUsdcAfter, config.collateralAmount);
  });

  it("should allow only owner to withdraw and update balances", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { collateralVault, usdcMock } = contracts;
    const { owner, seller } = accounts;

    await viem.assertions.revertWithCustomError(
      collateralVault.write.withdrawInsuranceFund([seller.account.address, 1n], {
        account: seller.account,
      }),
      collateralVault,
      "OwnableUnauthorizedAccount",
    );

    const withdrawAmount = config.collateralAmount / 2n;
    const balanceBefore = await collateralVault.read.insuranceFundBalance();
    const ownerUsdcBefore = await usdcMock.read.balanceOf([owner.account.address]);

    await collateralVault.write.withdrawInsuranceFund([owner.account.address, withdrawAmount], {
      account: owner.account,
    });

    const balanceAfter = await collateralVault.read.insuranceFundBalance();
    const ownerUsdcAfter = await usdcMock.read.balanceOf([owner.account.address]);

    assert.equal(balanceBefore - balanceAfter, withdrawAmount);
    assert.equal(ownerUsdcAfter - ownerUsdcBefore, withdrawAmount);
  });
});
