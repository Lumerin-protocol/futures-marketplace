import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getContract, parseUnits } from "viem";
import { deployContract, deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * CF-007 upgrade migration: orders resting before 6.10 carry no `Σ price²·qty` moments.
 * Removing one would underflow, and the fill-loss bound would read too little. The owner
 * rebuilds the moments from the canonical orders in the upgrade batch.
 */
describe("CF-007 — order-moment upgrade migration", () => {
  it("rebuildOrderMoments restores pre-upgrade orders exactly so they stay removable", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer, pc } = accounts;
    const expiry = config.deliveryDates[0];
    const mark = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const user = seller.account.address;

    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: seller.account });
    await futures.write.createOrder([mark + 10n * step, expiry, 2n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([mark - 50n * step, expiry, 3n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([mark + 30n * step, expiry, -1n, TimeInForce.GTC], { account: seller.account });
    const before = await futures.read.getRiskView([user]);

    // Reproduce the pre-upgrade state: the orders rest, their moments are gone.
    const harness = await deployContract<"HashPowerFuturesMigrationHarness">(
      owner,
      pc,
      "../artifacts/contracts/mocks/HashPowerFuturesMigrationHarness.sol/HashPowerFuturesMigrationHarness.json",
      [collateralVault.address],
    );
    await futures.write.upgradeToAndCall([harness.address, "0x"], { account: owner.account });
    const asHarness = getContract({ address: futures.address, abi: harness.abi, client: { public: pc, wallet: owner } });
    await asHarness.write.clearOrderMoments([user, expiry], { account: owner.account });

    await viem.assertions.revertWithCustomError(
      futures.write.rebuildOrderMoments([[user], [expiry]], { account: buyer.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.rebuildOrderMoments([[user], []], { account: owner.account }),
      futures,
      "ArrayLengthMismatch",
    );

    await futures.write.rebuildOrderMoments([[user], [expiry]], { account: owner.account });
    assert.deepEqual(await futures.read.getRiskView([user]), before, "rebuild restores the exact risk view");

    for (const id of await futures.read.getUserOrdersAtExpiration([user, expiry])) {
      await futures.write.cancelOrder([id], { account: seller.account });
    }
    const after = await futures.read.getRiskView([user]);
    assert.equal(after.buyOrderFillLoss, 0n);
    assert.equal(after.sellOrderFillLoss, 0n);
  });
});
