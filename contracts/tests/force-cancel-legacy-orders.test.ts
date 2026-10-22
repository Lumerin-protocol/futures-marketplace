import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  numberToHex,
  parseUnits,
} from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { getUserOrders } from "./lib/viewHelpers.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/** `participantExpirationAtRestingOrderAggregate` in the compiler storage layout. */
const RESTING_ORDER_AGGREGATE_SLOT = 37n;
const AGGREGATE_FIELDS = 6n;
const EMPTY_AGGREGATE = { buyQty: 0n, sellQty: 0n, buyPQ: 0n, buyP2Q: 0n, sellPQ: 0n, sellP2Q: 0n };

/** Empty one expiry's 6.10 aggregate, as it is for orders placed before the upgrade. */
async function eraseAggregate(proxy: Address, user: Address, expirationAt: bigint) {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [user, RESTING_ORDER_AGGREGATE_SLOT],
    ),
  );
  const base = BigInt(
    keccak256(
      encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [expirationAt, inner]),
    ),
  );
  for (let i = 0n; i < AGGREGATE_FIELDS; i++) {
    await networkHelpers.setStorageAt(proxy, numberToHex(base + i, { size: 32 }), 0n);
  }
}

async function legacyBookFixture(_conn: Parameters<typeof deployFuturesFixture>[0]) {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { futures, collateralVault } = data.contracts;
  const { buyer, seller } = data.accounts;
  const [d0, d1] = data.config.deliveryDates;
  const step = data.config.priceLadderStep;
  const mp = await futures.read.getMarketPrice();
  for (const user of [buyer, seller]) {
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: user.account });
  }
  await futures.write.createOrder([mp - step, d0, 2n, TimeInForce.GTC], { account: buyer.account });
  await futures.write.createOrder([mp + step, d1, -3n, TimeInForce.GTC], {
    account: buyer.account,
  });
  await futures.write.createOrder([mp + 2n * step, d0, -1n, TimeInForce.GTC], {
    account: seller.account,
  });
  for (const user of [buyer, seller]) {
    for (const expirationAt of [d0, d1]) {
      await eraseAggregate(futures.address, user.account.address, expirationAt);
      assert.deepEqual(
        await futures.read.getOrderAggregateAtExpiration([user.account.address, expirationAt]),
        EMPTY_AGGREGATE,
      );
    }
    assert.ok((await getUserOrders(futures, user.account.address)).length > 0);
  }
  return data;
}

/** Every (user, expiry) leg the legacy book uses. */
function legsOf(data: Awaited<ReturnType<typeof legacyBookFixture>>): [Address[], bigint[]] {
  const [d0, d1] = data.config.deliveryDates;
  const users = [data.accounts.buyer, data.accounts.seller].map((w) => w.account.address);
  return [users.flatMap((u) => [u, u]), users.flatMap(() => [d0, d1])];
}

async function assertBookCleared(data: Awaited<ReturnType<typeof legacyBookFixture>>) {
  const { futures } = data.contracts;
  for (const user of [data.accounts.buyer, data.accounts.seller]) {
    assert.deepEqual(await getUserOrders(futures, user.account.address), []);
    for (const expirationAt of data.config.deliveryDates.slice(0, 2)) {
      assert.deepEqual(
        await futures.read.getOrderAggregateAtExpiration([user.account.address, expirationAt]),
        EMPTY_AGGREGATE,
      );
      const [bids, asks] = await futures.read.getOrderBookPrices([expirationAt, 200n]);
      assert.deepEqual([...bids, ...asks], []);
    }
  }
}

describe("HashPowerFutures.forceCancelOrders on orders predating the 6.10 aggregate", () => {
  it("removes them although their quantities are missing from the aggregate", async () => {
    const data = await networkHelpers.loadFixture(legacyBookFixture);
    const { futures } = data.contracts;
    const { owner } = data.accounts;

    await futures.write.forceCancelOrders(legsOf(data), { account: owner.account });

    await assertBookCleared(data);
  });

  it("runs atomically as the upgrade call", async () => {
    const data = await networkHelpers.loadFixture(legacyBookFixture);
    const { futures, collateralVault } = data.contracts;
    const { owner } = data.accounts;
    const implementation = await viem.deployContract("HashPowerFutures", [collateralVault.address]);
    const cancelAll = encodeFunctionData({
      abi: implementation.abi,
      functionName: "forceCancelOrders",
      args: legsOf(data),
    });

    await futures.write.upgradeToAndCall([implementation.address, cancelAll], {
      account: owner.account,
    });

    await assertBookCleared(data);
  });
});
