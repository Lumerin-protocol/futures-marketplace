import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { networkHelpers } = await network.getOrCreate();

type OrderIntent = {
  price: bigint;
  expirationAt: bigint;
  quantity: number;
};

describe("Futures.updateOrders (cancel + create batch)", () => {
  it("cancels then places in one call with a single IM check", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];

    const resting: OrderIntent[] = [
      { price: mp + step, expirationAt: dd, quantity: -1 },
      { price: mp + 2n * step, expirationAt: dd, quantity: -1 },
    ];
    await futures.write.createOrders([resting], { account: seller.account });
    const before = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(before.length, 2);

    const next: OrderIntent[] = [
      { price: mp + 3n * step, expirationAt: dd, quantity: -1 },
      { price: mp + 4n * step, expirationAt: dd, quantity: -1 },
    ];
    const tx = await futures.write.updateOrders([before, next], { account: seller.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    assert.equal(receipt.status, "success");

    const cancelled = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCancelled",
    });
    const created = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    assert.equal(cancelled.length, 2);
    assert.equal(created.length, 2);

    const after = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(after.length, 2);
    for (const id of after) {
      assert.ok(!before.includes(id), "old ids must be gone");
    }
  });

  it("supports cancel-only and create-only batches", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];

    const createOnly: OrderIntent[] = [
      { price: mp + step, expirationAt: dd, quantity: -1 },
    ];
    await futures.write.updateOrders([[], createOnly], { account: seller.account });
    const placed = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(placed.length, 1);

    const cancelTx = await futures.write.updateOrders([placed, []], { account: seller.account });
    const cancelReceipt = await pc.waitForTransactionReceipt({ hash: cancelTx });
    assert.equal(cancelReceipt.status, "success");
    assert.equal((await futures.read.getUserOrders([seller.account.address])).length, 0);
  });

  it("is cheaper than multicall(cancelOrder × N + createOrders)", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];

    const sellerResting: OrderIntent[] = [
      { price: mp + step, expirationAt: dd, quantity: -1 },
      { price: mp + 2n * step, expirationAt: dd, quantity: -1 },
      { price: mp + 3n * step, expirationAt: dd, quantity: -1 },
    ];
    await futures.write.createOrders([sellerResting], { account: seller.account });
    const sellerIds = await futures.read.getUserOrders([seller.account.address]);

    const buyerResting: OrderIntent[] = [
      { price: mp - step, expirationAt: dd, quantity: 1 },
      { price: mp - 2n * step, expirationAt: dd, quantity: 1 },
      { price: mp - 3n * step, expirationAt: dd, quantity: 1 },
    ];
    await futures.write.createOrders([buyerResting], { account: buyer.account });
    const buyerIds = await futures.read.getUserOrders([buyer.account.address]);

    const baselineCalls: `0x${string}`[] = [];
    for (const id of sellerIds) {
      baselineCalls.push(
        encodeFunctionData({
          abi: futures.abi,
          functionName: "cancelOrder",
          args: [id],
        }),
      );
    }
    const sellerNext: OrderIntent[] = [
      { price: mp + 4n * step, expirationAt: dd, quantity: -1 },
      { price: mp + 5n * step, expirationAt: dd, quantity: -1 },
      { price: mp + 6n * step, expirationAt: dd, quantity: -1 },
    ];
    baselineCalls.push(
      encodeFunctionData({
        abi: futures.abi,
        functionName: "createOrders",
        args: [sellerNext],
      }),
    );
    const baselineTx = await futures.write.multicall([baselineCalls], { account: seller.account });
    const baselineGas = (await pc.waitForTransactionReceipt({ hash: baselineTx })).gasUsed;

    const buyerNext: OrderIntent[] = [
      { price: mp - 4n * step, expirationAt: dd, quantity: 1 },
      { price: mp - 5n * step, expirationAt: dd, quantity: 1 },
      { price: mp - 6n * step, expirationAt: dd, quantity: 1 },
    ];
    const batchTx = await futures.write.updateOrders([buyerIds, buyerNext], {
      account: buyer.account,
    });
    const batchGas = (await pc.waitForTransactionReceipt({ hash: batchTx })).gasUsed;

    assert.ok(
      batchGas < baselineGas,
      `updateOrders (${batchGas}) should be cheaper than multicall cancel+createOrders (${baselineGas})`,
    );
  });
});
