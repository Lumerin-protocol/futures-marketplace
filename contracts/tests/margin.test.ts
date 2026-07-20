import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice, scaleHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

async function positionWithMarginFixture() {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, collateralVault } = contracts;
  const { seller, buyer } = accounts;

  const entryPricePerDay = await futures.read.getMarketPrice();
  const margin = entryPricePerDay * 2n;
  const deliveryDate = config.deliveryDates[0];

  await collateralVault.write.deposit([margin], { account: seller.account });
  await collateralVault.write.deposit([margin], { account: buyer.account });

  await futures.write.createOrder([entryPricePerDay, deliveryDate, -1], {
    account: seller.account,
  });
  await futures.write.createOrder([entryPricePerDay, deliveryDate, 1], {
    account: buyer.account,
  });

  return {
    ...data,
    entryPricePerDay,
    margin,
    deliveryDate,
  };
}

// All cross-product margin checks now flow through the PortfolioMarginEngine,
// so these tests assert on `computePortfolioIM` / `computePortfolioMM` directly
// rather than the legacy futures-only `getMinMargin` helper deleted in v2.7.
describe("Futures - portfolio margin (PME)", () => {
  it("buyer IM grows on adverse mark, seller IM shrinks", async () => {
    const { contracts, accounts } = await positionWithMarginFixture();
    const { hashrateOracle, portfolioMarginEngine } = contracts;
    const { buyer, seller } = accounts;

    const buyerImBefore = await portfolioMarginEngine.read.computePortfolioIM([
      buyer.account.address,
    ]);
    const sellerImBefore = await portfolioMarginEngine.read.computePortfolioIM([
      seller.account.address,
    ]);
    // At market both sides only carry stress IM (no unrealized loss).
    assert.equal(sellerImBefore, buyerImBefore);

    // Drop hashprice so the buyer (long) accrues an unrealized loss.
    await scaleHashprice(hashrateOracle, 100n, 110n);

    const buyerImAfter = await portfolioMarginEngine.read.computePortfolioIM([
      buyer.account.address,
    ]);
    const sellerImAfter = await portfolioMarginEngine.read.computePortfolioIM([
      seller.account.address,
    ]);
    // Buyer's unrealized loss feeds into IM; seller's gain does NOT credit IM,
    // but their stress loss shrinks because the spot moved in their favor.
    assert.ok(buyerImAfter > buyerImBefore, "long IM grows on adverse move");
    assert.ok(sellerImAfter <= sellerImBefore, "short IM does not increase on favorable move");
  });

  it("withdraw is gated by portfolio IM", async () => {
    const { contracts, accounts } = await positionWithMarginFixture();
    const { collateralVault, portfolioMarginEngine } = contracts;
    const { buyer } = accounts;

    const balance = await collateralVault.read.balanceOf([buyer.account.address]);
    const im = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    assert.ok(balance >= im, "fixture leaves buyer above IM");

    // Withdrawing the entire surplus is fine; one wei beyond it must revert.
    const surplus = balance - im;
    await collateralVault.write.withdraw([surplus], { account: buyer.account });
    await viem.assertions.revertWithCustomError(
      collateralVault.write.withdraw([1n], { account: buyer.account }),
      collateralVault,
      "MarginBreach",
    );
  });

  it("active orders increase portfolio IM", async () => {
    const { contracts, accounts, deliveryDate } = await positionWithMarginFixture();
    const { futures, collateralVault, portfolioMarginEngine } = contracts;
    const { buyer } = accounts;

    const marketPricePerDay = await futures.read.getMarketPrice();
    await collateralVault.write.deposit([marketPricePerDay * 10n], { account: buyer.account });

    const imBefore = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    await futures.write.createOrder([marketPricePerDay, deliveryDate, -1], {
      account: buyer.account,
    });
    const imAfter = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    assert.ok(imAfter > imBefore, "resting order adds order margin to IM");
  });

  it("outdated orders drop out of IM after expiry", async () => {
    const { contracts, accounts, config } = await positionWithMarginFixture();
    const { futures, collateralVault, hashrateOracle, portfolioMarginEngine } = contracts;
    const { buyer, tc, pc } = accounts;
    const marketPricePerDay = await futures.read.getMarketPrice();

    const futureDeliveryDate = config.deliveryDates[1];
    await collateralVault.write.deposit([marketPricePerDay * 10n], { account: buyer.account });

    const txHash = await futures.write.createOrder([marketPricePerDay, futureDeliveryDate, 1], {
      account: buyer.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "OrderCreated" });

    const imWithActiveOrder = await portfolioMarginEngine.read.computePortfolioIM([
      buyer.account.address,
    ]);

    // Refresh the oracle at the post-expiry timestamp so PME's `getMarketPrice`
    // call doesn't trip the staleness guard after the time-warp.
    await refreshHashprice(hashrateOracle, futureDeliveryDate + 1n);
    await tc.setNextBlockTimestamp({ timestamp: futureDeliveryDate + 2n });
    await tc.mine({ blocks: 1 });

    const imWithOutdatedOrder = await portfolioMarginEngine.read.computePortfolioIM([
      buyer.account.address,
    ]);
    assert.ok(imWithOutdatedOrder <= imWithActiveOrder, "expired order does not contribute to IM");
  });
});

describe("Futures - margin management", () => {
  it("should allow adding margin", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { usdcMock, collateralVault } = contracts;
    const { seller, pc } = accounts;

    const sellerBalance1 = await collateralVault.read.balanceOf([seller.account.address]);
    const collateralVaultBalance1 = await usdcMock.read.balanceOf([
      contracts.collateralVault.address,
    ]);

    const marginAmount = parseUnits("1000", 6);

    const txHash = await collateralVault.write.deposit([marginAmount], { account: seller.account });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");

    const sellerBalance2 = await collateralVault.read.balanceOf([seller.account.address]);
    assert.equal(sellerBalance2, sellerBalance1 + marginAmount);

    const collateralVaultBalance2 = await usdcMock.read.balanceOf([
      contracts.collateralVault.address,
    ]);
    assert.equal(collateralVaultBalance2, collateralVaultBalance1 + marginAmount);
  });

  it("should allow removing margin when sufficient balance", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { collateralVault } = contracts;
    const { seller, pc } = accounts;

    const marginAmount = parseUnits("1000", 6);
    const removeAmount = parseUnits("500", 6);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });

    const txHash = await collateralVault.write.withdraw([removeAmount], {
      account: seller.account,
    });

    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    assert.equal(receipt.status, "success");

    const balance = await collateralVault.read.balanceOf([seller.account.address]);
    assert.equal(balance, marginAmount - removeAmount);
  });

  it("should reject removing margin when insufficient balance", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { collateralVault } = contracts;
    const { seller } = accounts;

    const marginAmount = parseUnits("1000", 6);
    const removeAmount = parseUnits("1500", 6);

    await collateralVault.write.deposit([marginAmount], { account: seller.account });

    await viem.assertions.revertWithCustomError(
      collateralVault.write.withdraw([removeAmount], { account: seller.account }),
      collateralVault,
      "ERC20InsufficientBalance",
    );
  });
});

