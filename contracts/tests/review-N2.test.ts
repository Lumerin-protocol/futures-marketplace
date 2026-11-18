import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { networkHelpers } = await network.getOrCreate();

/**
 * N2 (review, Medium): `getRiskView` reserves resting orders only on listed dates. Lowering
 * `futureExpirationDatesCount` unlisted the far dates, so an order resting there stopped being
 * reserved and its owner could withdraw the reserve. Once the window reached the date again, a
 * colluder filled the order with nothing behind it and the insurance fund paid the loss.
 */
describe("N2 — lowering the expiry window cannot release a resting order's reserve", () => {
  it("keeps the reserve of a bid on the farthest listed date in the account", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller } = accounts;
    const far = config.deliveryDates[config.deliveryDates.length - 1];

    const deposit = parseUnits("8000", 6);
    await collateralVault.write.deposit([deposit], { account: seller.account });
    const mark = await futures.read.getMarketPrice();
    await futures.write.createOrder([mark * 2n, far, 100n, TimeInForce.GTC], { account: seller.account });
    const reserve = (await futures.read.getRiskView([seller.account.address])).buyOrderFillLoss;
    assert.ok(reserve > 0n, "the bid is reserved while its date is listed");

    try {
      await futures.write.setFutureExpirationDatesCount([1], { account: owner.account });
    } catch {
      // a venue that refuses the shrink is fixed
    }
    try {
      await collateralVault.write.withdraw([deposit - parseUnits("1", 6)], { account: seller.account });
    } catch {
      // the reserve still holds the withdrawal back
    }

    assert.ok(
      (await collateralVault.read.balanceOf([seller.account.address])) >= reserve,
      "the bid's reserve must stay in the account",
    );
  });
});
