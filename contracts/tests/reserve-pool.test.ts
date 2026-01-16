import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFuturesFixture } from "./fixtures";
import { catchError } from "../lib/lib";

describe("Reserve Pool", function () {
  it("should not allow withdrawal of user funds from reserve pool", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { seller, owner } = accounts;

    await futures.write.withdrawReservePool([config.collateralAmount], {
      account: owner.account,
    });

    const price = await futures.read.getMarketPrice();
    const margin = price * 10n;

    await futures.write.addMargin([margin], {
      account: seller.account,
    });

    await catchError(futures.abi, "ERC20InsufficientBalance", async () => {
      await futures.write.withdrawReservePool([margin], {
        account: owner.account,
      });
    });
  });

  it("should increase reserve pool balance and mint wToken when deposited", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures, usdcMock } = contracts;
    const { owner } = accounts;

    const reserveBefore = await futures.read.reservePoolBalance();
    const wrappedBefore = await futures.read.balanceOf([futures.address]);
    const ownerBalanceBefore = await usdcMock.read.balanceOf([owner.account.address]);

    await futures.write.depositReservePool([config.collateralAmount], {
      account: owner.account,
    });

    const reserveAfter = await futures.read.reservePoolBalance();
    const wrappedAfter = await futures.read.balanceOf([futures.address]);
    const ownerBalanceAfter = await usdcMock.read.balanceOf([owner.account.address]);

    expect(reserveAfter - reserveBefore).to.equal(config.collateralAmount);
    expect(wrappedAfter - wrappedBefore).to.equal(config.collateralAmount);
    expect(ownerBalanceBefore - ownerBalanceAfter).to.equal(config.collateralAmount);
  });

  it("should allow only owner to withdraw and update balances", async function () {
    const { contracts, accounts, config } = await loadFixture(deployFuturesFixture);
    const { futures, usdcMock } = contracts;
    const { owner, seller } = accounts;

    await catchError(futures.abi, "OwnableUnauthorizedAccount", async () => {
      await futures.write.withdrawReservePool([1n], {
        account: seller.account,
      });
    });

    const withdrawAmount = config.collateralAmount / 2n;
    const reserveBefore = await futures.read.reservePoolBalance();
    const ownerBalanceBefore = await usdcMock.read.balanceOf([owner.account.address]);

    await futures.write.withdrawReservePool([withdrawAmount], {
      account: owner.account,
    });

    const reserveAfter = await futures.read.reservePoolBalance();
    const ownerBalanceAfter = await usdcMock.read.balanceOf([owner.account.address]);
    const wrappedAfter = await futures.read.balanceOf([futures.address]);

    expect(reserveBefore - reserveAfter).to.equal(withdrawAmount);
    expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(withdrawAmount);
    expect(wrappedAfter).to.equal(reserveAfter);
  });
});
