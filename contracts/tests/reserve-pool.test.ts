import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFuturesFixture } from "./fixtures";
import { catchError } from "../lib/lib";

describe("Reserve Pool", () => {
  it("should not allow withdrawal of more than the insurance fund balance", async () => {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { collateralVault } = contracts;
    const { owner } = accounts;

    const balance = await collateralVault.read.insuranceFundBalance();

    await catchError(collateralVault.abi, "ERC20InsufficientBalance", async () => {
      await collateralVault.write.withdrawInsuranceFund([owner.account.address, balance + 1n], {
        account: owner.account,
      });
    });
  });

  it("should increase insurance fund balance when deposited", async () => {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { collateralVault, usdcMock } = contracts;
    const { owner } = accounts;

    const balanceBefore = await collateralVault.read.insuranceFundBalance();
    const ownerUsdcBefore = await usdcMock.read.balanceOf([owner.account.address]);

    await collateralVault.write.depositInsuranceFund([owner.account.address, config.collateralAmount], {
      account: owner.account,
    });

    const balanceAfter = await collateralVault.read.insuranceFundBalance();
    const ownerUsdcAfter = await usdcMock.read.balanceOf([owner.account.address]);

    expect(balanceAfter - balanceBefore).to.equal(config.collateralAmount);
    expect(ownerUsdcBefore - ownerUsdcAfter).to.equal(config.collateralAmount);
  });

  it("should allow only owner to withdraw and update balances", async () => {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { collateralVault, usdcMock } = contracts;
    const { owner, seller } = accounts;

    await catchError(collateralVault.abi, "OwnableUnauthorizedAccount", async () => {
      await collateralVault.write.withdrawInsuranceFund([seller.account.address, 1n], {
        account: seller.account,
      });
    });

    const withdrawAmount = config.collateralAmount / 2n;
    const balanceBefore = await collateralVault.read.insuranceFundBalance();
    const ownerUsdcBefore = await usdcMock.read.balanceOf([owner.account.address]);

    await collateralVault.write.withdrawInsuranceFund([owner.account.address, withdrawAmount], {
      account: owner.account,
    });

    const balanceAfter = await collateralVault.read.insuranceFundBalance();
    const ownerUsdcAfter = await usdcMock.read.balanceOf([owner.account.address]);

    expect(balanceBefore - balanceAfter).to.equal(withdrawAmount);
    expect(ownerUsdcAfter - ownerUsdcBefore).to.equal(withdrawAmount);
  });
});
