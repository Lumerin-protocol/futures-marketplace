import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { networkHelpers } = await network.connect();

type OrderIntent = {
  price: bigint;
  expirationAt: bigint;
  quantity: bigint;
  timeInForce: number;
};

type ReduceIntent = {
  orderId: `0x${string}`;
  newQuantity: bigint;
};

describe("HashPowerFutures.updateOrders (cancel + reduce + create batch)", () => {
  it("cancels then places in one call with a single IM check", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];

    const resting: OrderIntent[] = [
      { price: mp + step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 2n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
    ];
    await futures.write.createOrders([resting], { account: seller.account });
    const before = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(before.length, 2);

    const next: OrderIntent[] = [
      { price: mp + 3n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 4n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
    ];
    const tx = await futures.write.updateOrders([before, [], next], { account: seller.account });
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
      { price: mp + step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
    ];
    await futures.write.updateOrders([[], [], createOnly], { account: seller.account });
    const placed = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(placed.length, 1);

    const cancelTx = await futures.write.updateOrders([placed, [], []], {
      account: seller.account,
    });
    const cancelReceipt = await pc.waitForTransactionReceipt({ hash: cancelTx });
    assert.equal(cancelReceipt.status, "success");
    assert.equal((await futures.read.getUserOrders([seller.account.address])).length, 0);
  });

  it("reduces size in place and keeps FIFO membership", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];
    const price = mp + step;

    await futures.write.createOrders(
      [
        [
          { price, expirationAt: dd, quantity: -8n, timeInForce: TimeInForce.GTC },
          { price, expirationAt: dd, quantity: -2n, timeInForce: TimeInForce.GTC },
        ],
      ],
      { account: seller.account },
    );
    const ids = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(ids.length, 2);
    const head = ids[0];

    const reduces: ReduceIntent[] = [{ orderId: head, newQuantity: -3n }];
    const tx = await futures.write.updateOrders([[], reduces, []], { account: seller.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    assert.equal(receipt.status, "success");

    const updated = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderUpdated",
    });
    const matched = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(updated.length, 1);
    assert.equal(matched.length, 0, "reduce must not emit OrderMatched");
    assert.equal(updated[0].args.orderId, head);
    assert.equal(updated[0].args.newQuantity, -3n);

    const afterIds = await futures.read.getUserOrders([seller.account.address]);
    assert.deepEqual(afterIds, ids, "order ids unchanged");
    assert.equal((await futures.read.getOrder([head])).quantity, -3n);

    await futures.write.reduceOrderSize([ids[1], -1n], { account: seller.account });
    assert.equal((await futures.read.getOrder([ids[1]])).quantity, -1n);
  });

  it("rejects grow, zero, and sign flip on reduce", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];
    await futures.write.createOrder([mp + step, dd, -4n, TimeInForce.GTC], {
      account: seller.account,
    });
    const [id] = await futures.read.getUserOrders([seller.account.address]);

    await assert.rejects(
      () => futures.write.reduceOrderSize([id, 0n], { account: seller.account }),
      /InvalidReduceQuantity/,
    );
    await assert.rejects(
      () => futures.write.reduceOrderSize([id, -5n], { account: seller.account }),
      /InvalidReduceQuantity/,
    );
    await assert.rejects(
      () => futures.write.reduceOrderSize([id, 2n], { account: seller.account }),
      /InvalidReduceQuantity/,
    );
  });

  it("is cheaper than separate cancelOrder and createOrders transactions", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    const mp = await futures.read.getMarketPrice();
    const step = config.priceLadderStep;
    const dd = config.deliveryDates[0];

    const sellerResting: OrderIntent[] = [
      { price: mp + step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 2n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 3n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
    ];
    await futures.write.createOrders([sellerResting], { account: seller.account });
    const sellerIds = await futures.read.getUserOrders([seller.account.address]);

    const buyerResting: OrderIntent[] = [
      { price: mp - step, expirationAt: dd, quantity: 1n, timeInForce: TimeInForce.GTC },
      { price: mp - 2n * step, expirationAt: dd, quantity: 1n, timeInForce: TimeInForce.GTC },
      { price: mp - 3n * step, expirationAt: dd, quantity: 1n, timeInForce: TimeInForce.GTC },
    ];
    await futures.write.createOrders([buyerResting], { account: buyer.account });
    const buyerIds = await futures.read.getUserOrders([buyer.account.address]);

    let baselineGas = 0n;
    for (const id of sellerIds) {
      const tx = await futures.write.cancelOrder([id], { account: seller.account });
      baselineGas += (await pc.waitForTransactionReceipt({ hash: tx })).gasUsed;
    }
    const sellerNext: OrderIntent[] = [
      { price: mp + 4n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 5n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
      { price: mp + 6n * step, expirationAt: dd, quantity: -1n, timeInForce: TimeInForce.GTC },
    ];
    const sellerCreateTx = await futures.write.createOrders([sellerNext], { account: seller.account });
    baselineGas += (await pc.waitForTransactionReceipt({ hash: sellerCreateTx })).gasUsed;

    const buyerNext: OrderIntent[] = [
      { price: mp - 4n * step, expirationAt: dd, quantity: 1n, timeInForce: TimeInForce.GTC },
      { price: mp - 5n * step, expirationAt: dd, quantity: 1n, timeInForce: TimeInForce.GTC },
      { price: mp - 6n * step, expirationAt: dd, quantity: 1n, timeInForce: TimeInForce.GTC },
    ];
    const batchTx = await futures.write.updateOrders([buyerIds, [], buyerNext], {
      account: buyer.account,
    });
    const batchGas = (await pc.waitForTransactionReceipt({ hash: batchTx })).gasUsed;

    assert.ok(
      batchGas < baselineGas,
      `updateOrders (${batchGas}) should be cheaper than separate cancel+create transactions (${baselineGas})`,
    );
  });
});
