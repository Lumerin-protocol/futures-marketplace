import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/** The admin module (N27): the owner-only bodies, run by delegatecall from the implementation. */
describe("HashPowerFutures - admin module", () => {
  it("runs the owner-only calls through the proxy: owner allowed, anyone else rejected", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = contracts;
    const { owner, buyer } = accounts;

    await futures.write.setMakerFeeBps([2], { account: owner.account });
    assert.equal(await futures.read.makerFeeBps(), 2);

    await viem.assertions.revertWithCustomError(
      futures.write.setMakerFeeBps([3], { account: buyer.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
    assert.equal(await futures.read.makerFeeBps(), 2);
  });

  it("cannot be used directly and reports the implementation's version", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const module = await viem.deployContract("HashPowerFuturesAdminModule", [contracts.collateralVault.address]);

    assert.equal(await module.read.VERSION(), await contracts.futures.read.VERSION());
    await viem.assertions.revertWithCustomError(
      module.write.setMakerFeeBps([1], { account: accounts.owner.account }),
      module,
      "OwnableUnauthorizedAccount",
    );
  });
});
