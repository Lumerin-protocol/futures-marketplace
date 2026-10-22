import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits, zeroAddress } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { getUserOrders } from "./lib/viewHelpers.ts";
import { TimeInForce } from "./timeInForce.ts";
import { refreshHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

const EMPTY_AGGREGATE = { buyQty: 0n, sellQty: 0n, buyPQ: 0n, buyP2Q: 0n, sellPQ: 0n, sellP2Q: 0n };

describe("HashPowerFutures.forceCancelOrders", () => {
  it("cancels every order on the listed legs and nothing else", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { owner, seller, buyer, pc } = accounts;
    const [d0, d1] = config.deliveryDates;
    const step = config.priceLadderStep;
    const mp = await futures.read.getMarketPrice();

    for (const user of [seller, buyer]) {
      await collateralVault.write.deposit([parseUnits("10000", 6)], { account: user.account });
    }
    await futures.write.createOrder([mp, d0, -1n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([mp, d0, 1n, TimeInForce.GTC], { account: buyer.account });
    for (const [price, expirationAt, quantity] of [
      [mp - step, d0, 2n],
      [mp - 2n * step, d0, 3n],
      [mp + step, d1, -4n],
    ] as const) {
      await futures.write.createOrder([price, expirationAt, quantity, TimeInForce.GTC], {
        account: buyer.account,
      });
    }
    await futures.write.createOrder([mp + 2n * step, d0, -5n, TimeInForce.GTC], {
      account: seller.account,
    });
    const buyerOrderIds = await getUserOrders(futures, buyer.account.address);
    const sellerOrderIds = await getUserOrders(futures, seller.account.address);
    const buyerPosition = await futures.read.getUserPosition([buyer.account.address, d0]);
    const sellerAggregate = await futures.read.getOrderAggregateAtExpiration([
      seller.account.address,
      d0,
    ]);
    assert.equal(buyerOrderIds.length, 3);
    assert.notEqual(buyerPosition.netQuantity, 0n);

    const buyerAddr = buyer.account.address;
    const hash = await futures.write.forceCancelOrders(
      [
        [buyerAddr, buyerAddr, buyerAddr],
        [d0, d1, d0],
      ],
      { account: owner.account },
    );
    const receipt = await pc.waitForTransactionReceipt({ hash });
    const cancelled = parseEventLogs({
      abi: futures.abi,
      logs: receipt.logs,
      eventName: "OrderCancelled",
    });
    assert.deepEqual(
      cancelled.map((event) => event.args.orderId).sort(),
      [...buyerOrderIds].sort(),
    );
    for (const event of cancelled) {
      assert.equal(getAddress(event.args.participant), getAddress(buyer.account.address));
    }

    assert.deepEqual(await getUserOrders(futures, buyer.account.address), []);
    for (const orderId of buyerOrderIds) {
      const order = await futures.read.getOrder([orderId]);
      assert.equal(order.participant, zeroAddress);
      assert.equal(order.quantity, 0n);
    }
    for (const expirationAt of [d0, d1]) {
      assert.deepEqual(
        await futures.read.getOrderAggregateAtExpiration([buyer.account.address, expirationAt]),
        EMPTY_AGGREGATE,
      );
    }
    const [bids0, asks0] = await futures.read.getOrderBookPrices([d0, 200n]);
    assert.deepEqual([...bids0], []);
    assert.deepEqual([...asks0], [mp + 2n * step]);
    const [bids1, asks1] = await futures.read.getOrderBookPrices([d1, 200n]);
    assert.deepEqual([...bids1, ...asks1], []);

    assert.deepEqual(
      await futures.read.getUserPosition([buyer.account.address, d0]),
      buyerPosition,
    );
    assert.deepEqual(await getUserOrders(futures, seller.account.address), sellerOrderIds);
    assert.deepEqual(
      await futures.read.getOrderAggregateAtExpiration([seller.account.address, d0]),
      sellerAggregate,
    );
  });

  it("is owner-only, checks array lengths, works while halted, and cancels expired legs", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault, hashpriceUsd } = contracts;
    const { owner, seller, tc } = accounts;
    const [expiredAt, laterAt] = config.deliveryDates;
    const price = parseUnits("40", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await futures.write.createOrder([price, expiredAt, -2n, TimeInForce.GTC], {
      account: seller.account,
    });
    const [expiredOrderId] = await getUserOrders(futures, seller.account.address);
    await futures.write.createOrder([price, laterAt, -3n, TimeInForce.GTC], {
      account: seller.account,
    });

    await tc.setNextBlockTimestamp({ timestamp: expiredAt + 1n });
    await tc.mine({ blocks: 1 });
    await refreshHashprice(hashpriceUsd, expiredAt + 1n);

    const sellerAddr = seller.account.address;
    await viem.assertions.revertWithCustomError(
      futures.write.forceCancelOrders([[sellerAddr], [laterAt]], { account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.forceCancelOrders([[sellerAddr], []], { account: owner.account }),
      futures,
      "ArrayLengthMismatch",
    );

    await collateralVault.write.halt({ account: owner.account });
    await futures.write.forceCancelOrders(
      [
        [sellerAddr, sellerAddr],
        [expiredAt, laterAt],
      ],
      {
        account: owner.account,
      },
    );

    assert.deepEqual(await getUserOrders(futures, sellerAddr), []);
    for (const expirationAt of [expiredAt, laterAt]) {
      assert.deepEqual(
        await futures.read.getOrderAggregateAtExpiration([sellerAddr, expirationAt]),
        EMPTY_AGGREGATE,
      );
    }
    assert.equal(
      (await futures.read.getOrder([expiredOrderId])).quantity,
      0n,
      "expired order removed",
    );
    assert.deepEqual(await futures.read.getUserOrdersAtExpiration([sellerAddr, expiredAt]), []);
  });
});
