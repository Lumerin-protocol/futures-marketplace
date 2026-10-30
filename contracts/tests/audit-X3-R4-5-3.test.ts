import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { networkHelpers } = await network.getOrCreate();

/**
 * X3-R4-5-3: `forceClosePositions` realized each listed leg against the insurance fund with no
 * backstop hand-off, so closing a subset left `Σ(users) + backstop ≠ 0` at that expiry and the
 * fund holding an untracked position.
 */
describe("X3-R4-5-3 — futures force-close hands the closed size to the backstop", () => {
  it("keeps users plus backstop summing to zero when only one side is closed", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer } = accounts;

    await futures.write.setMakerFeeBps([0], { account: owner.account });
    await futures.write.setTakerFeeBps([0], { account: owner.account });
    const entry = await futures.read.getMarketPrice();
    const deliveryDate = config.deliveryDates[0];
    const lotCount = 10n;
    await collateralVault.write.deposit([entry * 100n], { account: seller.account });
    await collateralVault.write.deposit([entry * 100n], { account: buyer.account });
    await futures.write.createOrder([entry, deliveryDate, -lotCount, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([entry, deliveryDate, lotCount, TimeInForce.GTC], {
      account: buyer.account,
    });

    await collateralVault.write.halt({ account: owner.account });
    await futures.write.forceClosePositions([[buyer.account.address], [deliveryDate]], {
      account: owner.account,
    });

    const backstop = await futures.read.BACKSTOP();
    let sum = 0n;
    for (const who of [seller.account.address, buyer.account.address, backstop]) {
      sum += (await futures.read.getUserPosition([who, deliveryDate])).netQuantity;
    }
    assert.equal(
      (await futures.read.getUserPosition([buyer.account.address, deliveryDate])).netQuantity,
      0n,
    );
    assert.equal(sum, 0n, "seller's short is left facing nothing");
    assert.equal(
      (await futures.read.getUserPosition([backstop, deliveryDate])).netQuantity,
      lotCount,
    );
  });
});
