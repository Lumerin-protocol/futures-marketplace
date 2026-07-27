import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture, type FuturesFixture } from "./fixtures.ts";
import { quantizePrice, refreshHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

// Opens a matched lot (seller short / buyer long) at `entryPrice` on the first expiration date.
async function openLot(
  data: FuturesFixture,
  entryPrice: bigint,
  expirationAt: bigint,
) {
  const { futures } = data.contracts;
  const { seller, buyer, pc } = data.accounts;
  await futures.write.createOrder([entryPrice, expirationAt, -1n], { account: seller.account });
  const txHash = await futures.write.createOrder([entryPrice, expirationAt, 1n], {
    account: buyer.account,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  const [matched] = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "OrderMatched" });
  return matched.args.expirationAt as bigint;
}

// The buyer (long at a price well above the ~$34.40 oracle mark) is the loser: at settlement
// the long realizes (mark - entry) * days < 0. We use entry $100 so the loss is large and the
// buyer is the constrained party for the collateral-hold assertions.
const ENTRY = parseUnits("100", 6);

describe("Futures collateral hold until settlement", () => {
  it("keeps a matured-unsettled position counted in margin (loser cannot withdraw)", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, portfolioMarginEngine, hashpriceUsd } = contracts;
    const { seller, buyer, tc } = accounts;
    const deliveryDate = config.deliveryDates[0];
    const entry = quantizePrice(ENTRY, config.priceLadderStep);
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await openLot(data, entry, deliveryDate);

    // Warp to maturity and pin the price (buyer is now the loser).
    await refreshHashprice(hashpriceUsd, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    await futures.write.recordSettlementPrice([deliveryDate], { account: seller.account });
    const pinned = await futures.read.settlementPrice([deliveryDate]);
    const expectedLoss = entry - pinned; // positive magnitude of the long's loss

    // The matured position still imposes IM equal to the pinned loss, with no stress delta
    // (the priced date carries no remaining market risk).
    assert.equal(await futures.read.getNetPositionDelta([buyer.account.address]), 0n);
    assert.equal(await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]), expectedLoss);

    // Loser cannot withdraw the collateral that backs the winner's payout.
    const balance = await collateralVault.read.balanceOf([buyer.account.address]);
    await viem.assertions.revertWithCustomError(
      collateralVault.write.withdraw([balance], { account: buyer.account }),
      collateralVault,
      "MarginBreach",
    );
  });

  it("settlement fully pays the winner with no bad debt even after the loser withdraws to the limit", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, portfolioMarginEngine, hashpriceUsd } = contracts;
    const { seller, buyer, validator, tc, pc } = accounts;
    const deliveryDate = config.deliveryDates[0];
    const entry = quantizePrice(ENTRY, config.priceLadderStep);
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await openLot(data, entry, deliveryDate);

    await refreshHashprice(hashpriceUsd, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    await futures.write.recordSettlementPrice([deliveryDate], { account: seller.account });
    const pinned = await futures.read.settlementPrice([deliveryDate]);
    const expectedLoss = entry - pinned;

    // Loser withdraws everything they are allowed to (balance - IM), leaving exactly the loss.
    const balance = await collateralVault.read.balanceOf([buyer.account.address]);
    const im = await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]);
    await collateralVault.write.withdraw([balance - im], { account: buyer.account });

    const sellerBefore = await collateralVault.read.balanceOf([seller.account.address]);

    // Settle both unilateral aggregates (permissionless). Winner is fully paid; no BadDebt.
    const buyerReceipt = await pc.waitForTransactionReceipt({
      hash: await futures.write.settlePosition([buyer.account.address, deliveryDate], {
        account: validator.account,
      }),
    });
    assert.equal(
      parseEventLogs({ logs: buyerReceipt.logs, abi: futures.abi, eventName: "BadDebt" }).length,
      0,
    );
    await futures.write.settlePosition([seller.account.address, deliveryDate], {
      account: validator.account,
    });

    const sellerAfter = await collateralVault.read.balanceOf([seller.account.address]);
    assert.equal(sellerAfter - sellerBefore, expectedLoss); // winner gets the full profit
    assert.equal(await collateralVault.read.balanceOf([buyer.account.address]), 0n);
  });

  it("counts matured-unpriced positions and releases margin only after settlement", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, portfolioMarginEngine, hashpriceUsd } = contracts;
    const { seller, buyer, validator, tc } = accounts;
    const deliveryDate = config.deliveryDates[0];
    const entry = quantizePrice(ENTRY, config.priceLadderStep);
    const margin = parseUnits("10000", 6);

    await collateralVault.write.deposit([margin], { account: seller.account });
    await collateralVault.write.deposit([margin], { account: buyer.account });
    await openLot(data, entry, deliveryDate);

    const deltaOpen = await futures.read.getNetPositionDelta([buyer.account.address]);
    assert.notEqual(deltaOpen, 0n); // long counted while open

    // Warp past maturity WITHOUT pinning a price: the position must still be counted.
    await refreshHashprice(hashpriceUsd, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    assert.equal(await futures.read.getNetPositionDelta([buyer.account.address]), deltaOpen);
    assert.equal(await futures.read.settlementPrice([deliveryDate]), 0n);

    // Settle both sides (lazy-pins); dates leave the active set and margin returns to baseline.
    await futures.write.settlePosition([buyer.account.address, deliveryDate], {
      account: validator.account,
    });
    await futures.write.settlePosition([seller.account.address, deliveryDate], {
      account: validator.account,
    });
    assert.equal(await futures.read.getNetPositionDelta([buyer.account.address]), 0n);
    assert.equal(await portfolioMarginEngine.read.computePortfolioIM([buyer.account.address]), 0n);
  });
});
