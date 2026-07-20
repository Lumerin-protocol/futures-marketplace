import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/** Mirrors `Futures.TimeInForce`. */
const TimeInForce = { GTC: 0, IOC: 1, FOK: 2 } as const;

describe("Futures - createOrderV2 time-in-force", () => {
  it("IOC fills available size and does not rest the remainder", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;
    const dd = config.deliveryDates[0];
    const price = parseUnits("100", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([price, dd, -2], { account: seller.account });

    const tx = await futures.write.createOrderV2([price, dd, 5, TimeInForce.IOC], {
      account: buyer.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const matches = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].args.takerQuantity, 2n);

    const updated = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderUpdated",
    });
    // Maker reduced/removed + taker closed at 0 (no rest).
    const takerZero = updated.filter((e) => e.args.newQuantity === 0n);
    assert.ok(takerZero.length >= 1);

    const [bids, asks] = await futures.read.getOrderBookPrices([dd, 50n]);
    assert.equal(bids.length, 0, "IOC remainder must not rest as a bid");
    assert.equal(asks.length, 0);
    assert.equal((await futures.read.getUserOrders([buyer.account.address])).length, 0);
  });

  it("IOC with no liquidity reverts TimeInForceNotFilled", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { buyer } = accounts;
    const dd = config.deliveryDates[0];
    const price = parseUnits("100", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await viem.assertions.revertWithCustomError(
      futures.write.createOrderV2([price, dd, 1, TimeInForce.IOC], { account: buyer.account }),
      futures,
      "TimeInForceNotFilled",
    );
    assert.equal((await futures.read.getUserOrders([buyer.account.address])).length, 0);
  });

  it("FOK reverts when the book cannot fill the full size", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;
    const dd = config.deliveryDates[0];
    const price = parseUnits("100", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([price, dd, -1], { account: seller.account });

    await viem.assertions.revertWithCustomError(
      futures.write.createOrderV2([price, dd, 2, TimeInForce.FOK], { account: buyer.account }),
      futures,
      "TimeInForceNotFilled",
    );

    // Maker ask still resting — FOK reverted with no fills.
    assert.equal(await futures.read.getQuantityAtPrice([dd, price, false]), 1n);
  });

  it("FOK fills fully when liquidity is sufficient and does not rest", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;
    const dd = config.deliveryDates[0];
    const price = parseUnits("100", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([price, dd, -3], { account: seller.account });

    const tx = await futures.write.createOrderV2([price, dd, 3, TimeInForce.FOK], {
      account: buyer.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const matches = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].args.takerQuantity, 3n);
    assert.equal((await futures.read.getUserOrders([buyer.account.address])).length, 0);
    assert.equal(await futures.read.getQuantityAtPrice([dd, price, false]), 0n);
  });

  it("createOrder remains GTC and rests unfilled size", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;
    const dd = config.deliveryDates[0];
    const price = parseUnits("100", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([price, dd, -1], { account: seller.account });
    await futures.write.createOrder([price, dd, 3], { account: buyer.account });

    assert.equal(await futures.read.getQuantityAtPrice([dd, price, true]), 2n);
    assert.equal((await futures.read.getUserOrders([buyer.account.address])).length, 1);
  });
});
