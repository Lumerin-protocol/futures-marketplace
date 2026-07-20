import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture, type FuturesFixture } from "./fixtures.ts";
import { quantizePrice, refreshHashprice, scaleHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/** Open a matched long for buyer / short for seller at ~$100 on the first expiration date. */
async function openPosition() {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { contracts, accounts, config } = data;
  const { futures, collateralVault } = contracts;
  const { seller, buyer, pc } = accounts;

  const marginAmount = parseUnits("10000", 6);
  const deliveryDate = config.deliveryDates[0];
  const entryPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

  await collateralVault.write.deposit([marginAmount], { account: seller.account });
  await collateralVault.write.deposit([marginAmount], { account: buyer.account });

  await futures.write.createOrder([entryPrice, deliveryDate, -1], { account: seller.account });
  const txHash = await futures.write.createOrder([entryPrice, deliveryDate, 1], {
    account: buyer.account,
  });
  await pc.waitForTransactionReceipt({ hash: txHash });

  const buyerPos = await futures.read.getUserPosition([buyer.account.address, deliveryDate]);
  const sellerPos = await futures.read.getUserPosition([seller.account.address, deliveryDate]);
  assert.equal(buyerPos.netQuantity, 1n);
  assert.equal(sellerPos.netQuantity, -1n);

  return { ...data, deliveryDate, entryPrice };
}

async function reachMaturityWithMovedMark(
  contracts: FuturesFixture["contracts"],
  tc: FuturesFixture["accounts"]["tc"],
  expirationAt: bigint,
) {
  await scaleHashprice(contracts.hashrateOracle, 12n, 10n);
  await refreshHashprice(contracts.hashrateOracle, expirationAt);
  await tc.setNextBlockTimestamp({ timestamp: expirationAt });
}

describe("Futures settlePosition", () => {
  it("lets any address permissionlessly cash-settle a matured aggregate position", async () => {
    const data = await openPosition();
    const { contracts, accounts, deliveryDate } = data;
    const { futures, collateralVault } = contracts;
    const { seller, buyer, buyer2, pc, tc } = accounts;

    await reachMaturityWithMovedMark(contracts, tc, deliveryDate);

    const sellerBefore = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerBefore = await collateralVault.read.balanceOf([buyer.account.address]);

    const txHash = await futures.write.settlePosition([buyer.account.address, deliveryDate], {
      account: buyer2.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [buyerSettled] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "PositionSettled",
    });

    assert.equal(getAddress(buyerSettled.args.user), getAddress(buyer.account.address));
    assert.equal(buyerSettled.args.expirationAt, deliveryDate);
    assert.equal(buyerSettled.args.closedQuantity, 1n);
    assert.equal(getAddress(buyerSettled.args.settledBy), getAddress(buyer2.account.address));
    assert.notEqual(buyerSettled.args.pnl, 0n);

    // Settle the short side too.
    await futures.write.settlePosition([seller.account.address, deliveryDate], {
      account: buyer2.account,
    });

    const sellerAfter = await collateralVault.read.balanceOf([seller.account.address]);
    const buyerAfter = await collateralVault.read.balanceOf([buyer.account.address]);
    assert.equal(buyerAfter - buyerBefore, buyerSettled.args.pnl);
    // Seller PnL is opposite direction at same entry; magnitudes match.
    assert.equal(sellerBefore - sellerAfter, buyerSettled.args.pnl);

    assert.equal((await futures.read.getUserPosition([buyer.account.address, deliveryDate])).netQuantity, 0n);
    assert.equal((await futures.read.getUserPosition([seller.account.address, deliveryDate])).netQuantity, 0n);
  });

  it("reverts before maturity", async () => {
    const { contracts, accounts, deliveryDate } = await openPosition();
    const { futures } = contracts;
    const { buyer } = accounts;

    await viem.assertions.revertWithCustomError(
      futures.write.settlePosition([buyer.account.address, deliveryDate], { account: buyer.account }),
      futures,
      "PositionExpirationNotStartedYet",
    );
  });

  it("reverts when user has no position at expirationAt", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { buyer, tc } = accounts;
    const expirationAt = config.deliveryDates[0];

    await refreshHashprice(contracts.hashrateOracle, expirationAt);
    await tc.setNextBlockTimestamp({ timestamp: expirationAt });

    await viem.assertions.revertWithCustomError(
      futures.write.settlePosition([buyer.account.address, expirationAt], {
        account: buyer.account,
      }),
      futures,
      "PositionNotExists",
    );
  });

  it("settlePositions settles a batch of users at an expiry", async () => {
    const { contracts, accounts, deliveryDate } = await openPosition();
    const { futures } = contracts;
    const { seller, buyer, buyer2, tc } = accounts;

    await reachMaturityWithMovedMark(contracts, tc, deliveryDate);

    await futures.write.settlePositions(
      [
        [buyer.account.address, seller.account.address],
        [deliveryDate, deliveryDate],
      ],
      { account: buyer2.account },
    );

    assert.equal((await futures.read.getUserPosition([buyer.account.address, deliveryDate])).netQuantity, 0n);
    assert.equal((await futures.read.getUserPosition([seller.account.address, deliveryDate])).netQuantity, 0n);
  });
});
