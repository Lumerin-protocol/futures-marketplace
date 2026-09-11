import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice, scaleHashprice } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";
import {
  getUserOrders,
} from "./lib/viewHelpers.ts";

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

  await futures.write.createOrder([entryPricePerDay, deliveryDate, -1n, TimeInForce.GTC], {
    account: seller.account,
  });
  await futures.write.createOrder([entryPricePerDay, deliveryDate, 1n, TimeInForce.GTC], {
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
    const { hashpriceUsd, portfolioMarginEngine } = contracts;
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
    await scaleHashprice(hashpriceUsd, 100n, 110n);

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

  it("position-increasing resting orders increase portfolio IM", async () => {
    const { contracts, accounts, deliveryDate, config } = await positionWithMarginFixture();
    const { futures, collateralVault, portfolioMarginEngine } = contracts;
    const { buyer } = accounts;

    const marketPricePerDay = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    await collateralVault.write.deposit([marketPricePerDay * 10n], { account: buyer.account });

    const imBefore = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    // Same-side bid (long + resting buy) — not reduce-only, must lock order margin.
    await futures.write.createOrder([marketPricePerDay - step, deliveryDate, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const imAfter = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    assert.ok(imAfter > imBefore, "increasing resting order adds order margin to IM");
  });

  it("reduce-only resting orders do not increase order margin", async () => {
    const { contracts, accounts, deliveryDate, config } = await positionWithMarginFixture();
    const { futures, portfolioMarginEngine } = contracts;
    const { buyer } = accounts;

    const marketPricePerDay = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const imBefore = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    assert.equal(
      await portfolioMarginEngine.read.orderMarginOf([buyer.account.address]),
      0n,
      "no resting orders yet",
    );

    // Buyer is long 1 — a resting sell of size 1 is fully reduce-only.
    await futures.write.createOrder(
      [marketPricePerDay + step, deliveryDate, -1n, TimeInForce.GTC],
      {
        account: buyer.account,
      },
    );

    // The venue no longer credits the order itself. The engine nets the sell-side order
    // delta into portfolio net delta, so the "all asks fill" leg lands at flat and the
    // (empty) buy leg — the position on its own — stays the binding one.
    const risk = await futures.read.getRiskView([buyer.account.address]);
    assert.equal(risk.sellOrderDelta, 10n ** 6n, "one contract of resting ask delta");
    assert.equal(risk.buyOrderDelta, 0n);
    assert.equal(risk.sellOrderFillLoss, 0n, "an ask above the mark fills at a gain, not a loss");

    const imAfter = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    assert.equal(
      imAfter,
      imBefore,
      "portfolio IM unchanged by a fully offsetting reduce-only order",
    );
    assert.equal(
      await portfolioMarginEngine.read.orderMarginOf([buyer.account.address]),
      0n,
      "an order that only moves the portfolio toward flat costs nothing",
    );
  });

  it("allows a reduce-only order when margin is tight", async () => {
    const data = await positionWithMarginFixture();
    const { contracts, accounts, deliveryDate, entryPricePerDay, config } = data;
    const { futures, collateralVault, portfolioMarginEngine } = contracts;
    const { buyer, owner } = accounts;

    // Real IM > MM buffer (fixture defaults IM==MM).
    await portfolioMarginEngine.write.setShocks(
      [parseUnits("0.20", 18), parseUnits("0.10", 18), 0n, 0n],
      { account: owner.account },
    );

    // Skin to just above IM, then increase only the IM shock to enter the
    // [MM, IM) band without changing the order's portfolio effect.
    const im0 = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    const bal0 = await collateralVault.read.balanceOf([buyer.account.address]);
    assert.ok(bal0 > im0 + 1n, "fixture should leave withdrawable surplus above IM");
    await collateralVault.write.withdraw([bal0 - im0 - 1n], { account: buyer.account });
    await portfolioMarginEngine.write.setShocks(
      [parseUnits("0.30", 18), parseUnits("0.10", 18), 0n, 0n],
      { account: owner.account },
    );

    const balAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    const im = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    const mm = await portfolioMarginEngine.read.computePortfolioMM([buyer.account.address]);
    assert.ok(im > mm, "need a real IM>MM buffer");
    assert.ok(balAfter >= mm, "buyer should remain above MM");
    assert.ok(balAfter < im, "buyer should be below IM so non-reduce creates fail");

    const step = config.priceLadderStep;
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([entryPricePerDay - step, deliveryDate, 1n, TimeInForce.GTC], {
        account: buyer.account,
      }),
      futures,
      "InsufficientMarginBalance",
    );

    await futures.write.createOrder([entryPricePerDay + step, deliveryDate, -1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const orders = await getUserOrders(futures, buyer.account.address);
    assert.equal(orders.length, 1, "reduce-only closing order should rest");
  });

  it("rejects a locally reducing order that increases portfolio IM", async () => {
    const data = await positionWithMarginFixture();
    const { contracts, accounts, deliveryDate, entryPricePerDay, config } = data;
    const { futures, collateralVault, portfolioMarginEngine, perpsDEXMock } = contracts;
    const { buyer, owner } = accounts;
    const buyerAddr = buyer.account.address;

    // Futures is long 1; a short 2 position elsewhere makes the portfolio net
    // short 1. A local sell looks reducing here but widens the portfolio's
    // all-asks-fill endpoint to short 2.
    await perpsDEXMock.write.setVault([collateralVault.address], { account: owner.account, chain: null });
    await perpsDEXMock.write.setUserPosition([buyerAddr, -2_000_000n, 0n], {
      account: owner.account,
      chain: null,
    });
    await portfolioMarginEngine.write.addLinearMarket([perpsDEXMock.address]);

    const imBefore = await portfolioMarginEngine.read.computePortfolioIM([buyerAddr]);
    const balance = await collateralVault.read.balanceOf([buyerAddr]);
    if (balance > imBefore) {
      await collateralVault.write.withdraw([balance - imBefore], { account: buyer.account });
    }

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder(
        [entryPricePerDay + config.priceLadderStep, deliveryDate, -1n, TimeInForce.GTC],
        { account: buyer.account },
      ),
      futures,
      "InsufficientMarginBalance",
    );
  });

  it("rejects a second stacked reduce-only order when margin is tight", async () => {
    const data = await positionWithMarginFixture();
    const { contracts, accounts, deliveryDate, entryPricePerDay, config } = data;
    const { futures, collateralVault, portfolioMarginEngine } = contracts;
    const { buyer, owner } = accounts;

    await portfolioMarginEngine.write.setShocks(
      [parseUnits("0.20", 18), parseUnits("0.10", 18), 0n, 0n],
      { account: owner.account },
    );

    const im0 = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    const bal0 = await collateralVault.read.balanceOf([buyer.account.address]);
    await collateralVault.write.withdraw([bal0 - im0 - 1n], { account: buyer.account });
    await portfolioMarginEngine.write.setShocks(
      [parseUnits("0.30", 18), parseUnits("0.10", 18), 0n, 0n],
      { account: owner.account },
    );

    const step = config.priceLadderStep;
    // First full-size reduce-only is allowed.
    await futures.write.createOrder([entryPricePerDay + step, deliveryDate, -1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    // Second would stack past the position — must not skip IM.
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder(
        [entryPricePerDay + 2n * step, deliveryDate, -1n, TimeInForce.GTC],
        {
          account: buyer.account,
        },
      ),
      futures,
      "InsufficientMarginBalance",
    );
  });

  it("rejects an opposite-side order larger than the position when margin is tight", async () => {
    const data = await positionWithMarginFixture();
    const { contracts, accounts, deliveryDate, entryPricePerDay, config } = data;
    const { futures, collateralVault, portfolioMarginEngine, hashpriceUsd } = contracts;
    const { buyer, owner } = accounts;

    await portfolioMarginEngine.write.setShocks(
      [parseUnits("0.20", 18), parseUnits("0.10", 18), 0n, 0n],
      { account: owner.account },
    );

    const im0 = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    const bal0 = await collateralVault.read.balanceOf([buyer.account.address]);
    await collateralVault.write.withdraw([bal0 - im0 - 1n], { account: buyer.account });
    await scaleHashprice(hashpriceUsd, 100n, 90n);

    const step = config.priceLadderStep;
    // Sell 2 while long 1 — would flip, not reduce-only.
    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([entryPricePerDay + step, deliveryDate, -2n, TimeInForce.GTC], {
        account: buyer.account,
      }),
      futures,
      "InsufficientMarginBalance",
    );
  });

  it("outdated orders drop out of IM after expiry", async () => {
    const { contracts, accounts, config } = await positionWithMarginFixture();
    const { futures, collateralVault, hashpriceUsd, portfolioMarginEngine } = contracts;
    const { buyer, tc, pc } = accounts;
    const marketPricePerDay = await futures.read.getMarketPrice();

    const futureDeliveryDate = config.deliveryDates[1];
    await collateralVault.write.deposit([marketPricePerDay * 10n], { account: buyer.account });

    const txHash = await futures.write.createOrder(
      [marketPricePerDay, futureDeliveryDate, 1n, TimeInForce.GTC],
      {
        account: buyer.account,
      },
    );
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "OrderCreated" });

    const imWithActiveOrder = await portfolioMarginEngine.read.computePortfolioIM([
      buyer.account.address,
    ]);

    // Refresh the oracle at the post-expiry timestamp so PME's `getMarketPrice`
    // call doesn't trip the staleness guard after the time-warp.
    await refreshHashprice(hashpriceUsd, futureDeliveryDate + 1n);
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
