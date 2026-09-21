import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, parseUnits, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";
import {
  getUserOrders,
} from "./lib/viewHelpers.ts";

const { viem, networkHelpers } = await network.getOrCreate();

describe("Futures per-delivery order-index cutover", () => {
  it("drops active legacy orders while preserving expired orders and positions", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer, tc } = accounts;
    const [expiredAt, activeAt] = config.deliveryDates;
    const price = parseUnits("40", 6);

    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("5000", 6)], { account: buyer.account });

    await futures.write.createOrder([price + config.priceLadderStep, expiredAt, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    const [expiredOrderId] = await futures.read.getUserOrdersAtExpiration([
      seller.account.address,
      expiredAt,
    ]);

    await futures.write.createOrder([price, activeAt, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([price, activeAt, 1n, TimeInForce.GTC], {
      account: buyer.account,
    });
    await futures.write.createOrder([price + 2n * config.priceLadderStep, activeAt, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    const [activeOrderId] = await futures.read.getUserOrdersAtExpiration([
      seller.account.address,
      activeAt,
    ]);
    const positionBefore = await futures.read.getUserPosition([seller.account.address, activeAt]);

    const harnessImplementation = await viem.deployContract("HashPowerFuturesOrderCacheMigrationHarness", [
      collateralVault.address,
    ]);
    await futures.write.upgradeToAndCall([harnessImplementation.address, "0x"], {
      account: owner.account,
    });
    const harness = await viem.getContractAt("HashPowerFuturesOrderCacheMigrationHarness", futures.address);
    await harness.write.moveOrdersToLegacyIndex([seller.account.address, expiredAt], {
      account: owner.account,
    });
    await harness.write.moveOrdersToLegacyIndex([seller.account.address, activeAt], {
      account: owner.account,
    });
    const futuresImplementation = await viem.deployContract("HashPowerFutures", [collateralVault.address]);
    await harness.write.upgradeToAndCall([futuresImplementation.address, "0x"], {
      account: owner.account,
    });
    const upgraded = await viem.getContractAt("HashPowerFutures", futures.address);

    await tc.setNextBlockTimestamp({ timestamp: expiredAt + 1n });
    await tc.mine({ blocks: 1 });

    assert.deepEqual(await getUserOrders(upgraded, seller.account.address), []);
    await upgraded.write.dropActiveOrders([[seller.account.address]], { account: owner.account });
    await upgraded.write.dropActiveOrders([[seller.account.address]], { account: owner.account });

    assert.equal((await upgraded.read.getOrder([activeOrderId])).participant, zeroAddress);
    assert.equal(
      getAddress((await upgraded.read.getOrder([expiredOrderId])).participant),
      getAddress(seller.account.address),
    );
    assert.deepEqual(
      await upgraded.read.getUserPosition([seller.account.address, activeAt]),
      positionBefore,
    );

    await assert.rejects(
      upgraded.write.dropActiveOrders([[seller.account.address]], { account: buyer.account }),
      /OwnableUnauthorizedAccount/,
    );

    await upgraded.write.removeOutdatedOrders([[expiredOrderId]], { account: buyer.account });
    assert.equal((await upgraded.read.getOrder([expiredOrderId])).participant, zeroAddress);
  });
});
