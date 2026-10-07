import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import type { NetworkConnection } from "hardhat/types/network";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * `seller` short 1 against `buyer` long 1 on the first delivery date, plus resting orders:
 * two seller asks on the first date and one on the second, a buyer bid, and a bid from
 * `buyer2`, who is never force-cancelled.
 */
async function bookFixture(_conn: NetworkConnection) {
  const data = await networkHelpers.loadFixture(deployFuturesFixture);
  const { futures, collateralVault } = data.contracts;
  const { seller, buyer, buyer2 } = data.accounts;
  const [first, second] = data.config.deliveryDates;
  const step = data.config.priceLadderStep;
  const price = await futures.read.getMarketPrice();

  for (const who of [seller, buyer, buyer2]) {
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: who.account });
  }
  await futures.write.createOrder([price, first, -1n, TimeInForce.GTC], { account: seller.account });
  await futures.write.createOrder([price, first, 1n, TimeInForce.GTC], { account: buyer.account });
  await futures.write.createOrder([price + step, first, -1n, TimeInForce.GTC], { account: seller.account });
  await futures.write.createOrder([price + 2n * step, first, -1n, TimeInForce.GTC], { account: seller.account });
  await futures.write.createOrder([price + step, second, -1n, TimeInForce.GTC], { account: seller.account });
  await futures.write.createOrder([price - step, first, 1n, TimeInForce.GTC], { account: buyer.account });
  await futures.write.createOrder([price - 2n * step, first, 1n, TimeInForce.GTC], { account: buyer2.account });

  return { ...data, config: { ...data.config, price, first, second } };
}

describe("HashPowerFutures.forceCancelOrders", function () {
  it("only runs while halted, for the owner, with matching arrays", async function () {
    const data = await networkHelpers.loadFixture(bookFixture);
    const { futures, collateralVault } = data.contracts;
    const { owner, seller } = data.accounts;
    const { first } = data.config;

    await viem.assertions.revertWithCustomError(
      futures.write.forceCancelOrders([[seller.account.address], [first]], { account: owner.account }),
      futures,
      "NotHalted",
    );
    await collateralVault.write.halt({ account: owner.account });
    await viem.assertions.revertWithCustomError(
      futures.write.forceCancelOrders([[seller.account.address], [first]], { account: seller.account }),
      futures,
      "OwnableUnauthorizedAccount",
    );
    await viem.assertions.revertWithCustomError(
      futures.write.forceCancelOrders([[seller.account.address], []], { account: owner.account }),
      futures,
      "ArrayLengthMismatch",
    );
  });

  it("cancels every order on the listed legs, one OrderCancelled each", async function () {
    const data = await networkHelpers.loadFixture(bookFixture);
    const { futures, collateralVault } = data.contracts;
    const { owner, seller, buyer2, pc } = data.accounts;
    const { first, second } = data.config;
    const sellerFirst = await futures.read.getUserOrdersAtExpiration([seller.account.address, first]);
    const sellerSecond = await futures.read.getUserOrdersAtExpiration([seller.account.address, second]);
    const bystander = await futures.read.getUserOrdersAtExpiration([buyer2.account.address, first]);
    const position = await futures.read.getUserPosition([seller.account.address, first]);

    await collateralVault.write.halt({ account: owner.account });
    const hash = await futures.write.forceCancelOrders(
      [[seller.account.address, seller.account.address, seller.account.address], [first, second, first]],
      { account: owner.account },
    );
    const receipt = await pc.waitForTransactionReceipt({ hash });
    const cancelled = parseEventLogs({ abi: futures.abi, logs: receipt.logs, eventName: "OrderCancelled" });

    assert.deepEqual(cancelled.map((e) => e.args.orderId).sort(), [...sellerFirst, ...sellerSecond].sort());
    for (const e of cancelled) {
      assert.equal(getAddress(e.args.participant), getAddress(seller.account.address));
    }
    for (const date of [first, second]) {
      assert.deepEqual(await futures.read.getUserOrdersAtExpiration([seller.account.address, date]), []);
      const [, asks] = await futures.read.getOrderBookPrices([date, 10n]);
      assert.deepEqual(asks, []);
    }
    assert.deepEqual(await futures.read.getUserOrdersAtExpiration([buyer2.account.address, first]), bystander);
    assert.deepEqual(
      await futures.read.getUserPosition([seller.account.address, first]),
      position,
      "positions are forceClosePositions' job",
    );
  });

  it("empties the venue with forceClosePositions, emitting an event for every change", async function () {
    const data = await networkHelpers.loadFixture(bookFixture);
    const { futures, collateralVault } = data.contracts;
    const { owner, seller, buyer, buyer2, pc } = data.accounts;
    const { first, second, price } = data.config;
    const legs = [
      [seller.account.address, first],
      [seller.account.address, second],
      [buyer.account.address, first],
      [buyer2.account.address, first],
    ] as const;
    let restingCount = 0;
    for (const [who, date] of legs) {
      restingCount += (await futures.read.getUserOrdersAtExpiration([who, date])).length;
    }

    await collateralVault.write.halt({ account: owner.account });
    const cancelReceipt = await pc.waitForTransactionReceipt({
      hash: await futures.write.forceCancelOrders(
        [legs.map(([who]) => who), legs.map(([, date]) => date)],
        { account: owner.account },
      ),
    });
    const closeReceipt = await pc.waitForTransactionReceipt({
      hash: await futures.write.forceClosePositions(
        [[seller.account.address, buyer.account.address], [first, first]],
        { account: owner.account },
      ),
    });
    await collateralVault.write.resume({ account: owner.account });

    assert.equal(
      parseEventLogs({ abi: futures.abi, logs: cancelReceipt.logs, eventName: "OrderCancelled" }).length,
      restingCount,
    );
    const liquidated = parseEventLogs({ abi: futures.abi, logs: closeReceipt.logs, eventName: "PositionLiquidated" });
    assert.deepEqual(
      liquidated.map((e) => [getAddress(e.args.user), e.args.expirationAt, e.args.closedQuantity, e.args.liquidatorFee]),
      [
        [getAddress(seller.account.address), first, -1n, 0n],
        [getAddress(buyer.account.address), first, 1n, 0n],
      ],
    );
    for (const [who, date] of legs) {
      assert.deepEqual(await futures.read.getUserOrdersAtExpiration([who, date]), []);
      assert.deepEqual(await futures.read.getUserPosition([who, date]), { netQuantity: 0n, netEntryValue: 0n });
    }
    for (const date of [first, second]) {
      assert.deepEqual(await futures.read.getOrderBookPrices([date, 10n]), [[], []]);
    }

    await futures.write.createOrder([price, first, 1n, TimeInForce.GTC], { account: buyer.account });
    assert.equal((await futures.read.getUserOrdersAtExpiration([buyer.account.address, first])).length, 1);
  });
});
