import { describe, it } from "node:test";
import { network } from "hardhat";
import { maxUint256, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * X3-D-1: a resting order whose quantity lifts to ~2^256 in the engine's WAD math wraps
 * the engine's signed order delta, reading IM ≈ 0 for an arbitrarily large book. The
 * venue must refuse such a quantity outright.
 */
describe("X3-D-1 — futures rejects quantities that overflow portfolio margin math", () => {
  // Whole contracts; getRiskView scales by 1e6 and the engine lifts by 1e12.
  const POISON_QTY = maxUint256 / 10n ** 18n;

  async function funded() {
    const fixture = await networkHelpers.loadFixture(deployFuturesFixture);
    const { collateralVault } = fixture.contracts;
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: fixture.accounts.seller.account });
    return fixture;
  }

  it("rejects a poison bid", async () => {
    const { contracts, accounts, config } = await funded();
    const { futures } = contracts;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([config.priceLadderStep, config.deliveryDates[0], POISON_QTY, TimeInForce.GTC], {
        account: accounts.seller.account,
      }),
      futures,
      "InvalidQty",
    );
  });

  it("rejects a poison ask", async () => {
    const { contracts, accounts, config } = await funded();
    const { futures } = contracts;
    const price = (await futures.read.getMarketPrice()) + config.priceLadderStep;

    await viem.assertions.revertWithCustomError(
      futures.write.createOrder([price, config.deliveryDates[0], -POISON_QTY, TimeInForce.GTC], {
        account: accounts.seller.account,
      }),
      futures,
      "InvalidQty",
    );
  });
});
