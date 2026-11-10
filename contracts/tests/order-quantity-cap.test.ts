import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * `MAX_ORDER_QUANTITY` is the bound X3-D-1 and the CF-007 overflow argument rest on. An order
 * at the cap clears quantity validation (an unfunded one then fails the margin check); one
 * contract above it is rejected outright.
 */
describe("HashPowerFutures order quantity cap", () => {
  for (const side of [1n, -1n]) {
    const label = side > 0n ? "a bid" : "an ask";

    it(`accepts ${label} at MAX_ORDER_QUANTITY and rejects one above it`, async () => {
      const { contracts, accounts, config } =
        await networkHelpers.loadFixture(deployFuturesFixture);
      const { futures, collateralVault } = contracts;
      const account = accounts.seller.account;
      await collateralVault.write.deposit([parseUnits("10000", 6)], { account });
      const price = await futures.read.getMarketPrice();
      const expirationAt = config.deliveryDates[0];
      const cap = await futures.read.MAX_ORDER_QUANTITY();

      await viem.assertions.revertWithCustomError(
        futures.write.createOrder([price, expirationAt, side * cap, TimeInForce.GTC], { account }),
        futures,
        "InsufficientMarginBalance",
      );
      await viem.assertions.revertWithCustomError(
        futures.write.createOrder([price, expirationAt, side * (cap + 1n), TimeInForce.GTC], {
          account,
        }),
        futures,
        "InvalidQty",
      );
    });
  }
});
