import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { TimeInForce } from "./timeInForce.ts";

const { networkHelpers } = await network.getOrCreate();

describe("Futures - limit order book", () => {
  it("buy walks asks up to limit and fills at each maker price", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;
    const dd = config.deliveryDates[0];
    const step = config.priceLadderStep;

    const askLo = parseUnits("100", 6);
    const askMid = askLo + step;
    const askHi = askMid + step;
    const buyLimit = askMid;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([askLo, dd, -1n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([askMid, dd, -1n, TimeInForce.GTC], {
      account: seller.account,
    });
    await futures.write.createOrder([askHi, dd, -1n, TimeInForce.GTC], { account: seller.account });

    const tx = await futures.write.createOrder([buyLimit, dd, 2n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    const matches = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });

    assert.equal(matches.length, 2);
    assert.equal(matches[0].args.tradePrice, askLo);
    assert.equal(matches[1].args.tradePrice, askMid);
    assert.equal(matches[0].args.takerQuantity, 1n);
    assert.equal(matches[1].args.takerQuantity, 1n);

    const [, asks] = await futures.read.getOrderBookPrices([dd, 50n]);
    assert.deepEqual([...asks], [askHi]);
    assert.equal(await futures.read.getBestAskPrice([dd]), askHi);
    assert.equal(await futures.read.getBestBidPrice([dd]), 0n);
  });

  it("sell walks bids down to limit and fills at each maker price", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;
    const dd = config.deliveryDates[0];
    const step = config.priceLadderStep;

    const bidHi = parseUnits("100", 6);
    const bidMid = bidHi - step;
    const bidLo = bidMid - step;
    const sellLimit = bidMid;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([bidHi, dd, 1n, TimeInForce.GTC], { account: buyer.account });
    await futures.write.createOrder([bidMid, dd, 1n, TimeInForce.GTC], { account: buyer.account });
    await futures.write.createOrder([bidLo, dd, 1n, TimeInForce.GTC], { account: buyer.account });

    const tx = await futures.write.createOrder([sellLimit, dd, -2n, TimeInForce.GTC], {
      account: seller.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    const matches = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });

    assert.equal(matches.length, 2);
    assert.equal(matches[0].args.tradePrice, bidHi);
    assert.equal(matches[1].args.tradePrice, bidMid);

    const [bids] = await futures.read.getOrderBookPrices([dd, 50n]);
    assert.deepEqual([...bids], [bidLo]);
    assert.equal(await futures.read.getBestBidPrice([dd]), bidLo);
    assert.equal(await futures.read.getBestAskPrice([dd]), 0n);
  });

  it("partial multi-level fill rests remainder at taker limit", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer, pc } = accounts;
    const dd = config.deliveryDates[0];
    const step = config.priceLadderStep;

    const askLo = parseUnits("100", 6);
    const buyLimit = askLo + step;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([askLo, dd, -1n, TimeInForce.GTC], { account: seller.account });

    const tx = await futures.write.createOrder([buyLimit, dd, 3n, TimeInForce.GTC], {
      account: buyer.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });

    const matches = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].args.tradePrice, askLo);

    const [bids, asks] = await futures.read.getOrderBookPrices([dd, 50n]);
    assert.equal(asks.length, 0);
    assert.deepEqual([...bids], [buyLimit]);
    assert.equal(await futures.read.getQuantityAtPrice([dd, buyLimit, true]), 2n);
    assert.equal(await futures.read.getBestBidPrice([dd]), buyLimit);

    const created = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });
    const resting = await futures.read.getOrder([created[0].args.orderId]);
    assert.equal(resting.quantity, 2n);
    assert.equal(resting.price, buyLimit);
  });

  it("self-cross nets out without OrderMatched or fees", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, pc } = accounts;
    const dd = config.deliveryDates[0];
    const step = config.priceLadderStep;

    const askLo = parseUnits("100", 6);
    const buyLimit = askLo + step;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    const balBefore = await collateralVault.read.balanceOf([seller.account.address]);

    const askTx = await futures.write.createOrder([askLo, dd, -2n, TimeInForce.GTC], {
      account: seller.account,
    });
    const askReceipt = await pc.waitForTransactionReceipt({ hash: askTx });
    const [askCreated] = parseEventLogs({
      logs: askReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCreated",
    });

    const buyTx = await futures.write.createOrder([buyLimit, dd, 2n, TimeInForce.GTC], {
      account: seller.account,
    });
    const buyReceipt = await pc.waitForTransactionReceipt({ hash: buyTx });

    const matches = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "OrderMatched",
    });
    assert.equal(matches.length, 0);

    const cancelled = parseEventLogs({
      logs: buyReceipt.logs,
      abi: futures.abi,
      eventName: "OrderCancelled",
    });
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].args.orderId, askCreated.args.orderId);

    assert.equal(await collateralVault.read.balanceOf([seller.account.address]), balBefore);
    assert.equal(await futures.read.getBestAskPrice([dd]), 0n);
    assert.equal(await futures.read.getBestBidPrice([dd]), 0n);
  });

  it("getOrderBookPrices returns bids high-to-low and asks low-to-high", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;
    const dd = config.deliveryDates[0];
    const step = config.priceLadderStep;

    const ask0 = parseUnits("102", 6);
    const ask1 = ask0 + step;
    const ask2 = ask1 + step;
    const bid0 = parseUnits("100", 6);
    const bid1 = bid0 - step;
    const bid2 = bid1 - step;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([ask2, dd, -1n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([ask0, dd, -1n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([ask1, dd, -1n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([bid2, dd, 1n, TimeInForce.GTC], { account: buyer.account });
    await futures.write.createOrder([bid0, dd, 1n, TimeInForce.GTC], { account: buyer.account });
    await futures.write.createOrder([bid1, dd, 1n, TimeInForce.GTC], { account: buyer.account });

    const [bids, asks] = await futures.read.getOrderBookPrices([dd, 50n]);
    assert.deepEqual([...asks], [ask0, ask1, ask2]);
    assert.deepEqual([...bids], [bid0, bid1, bid2]);
    assert.equal(await futures.read.getBestAskPrice([dd]), ask0);
    assert.equal(await futures.read.getBestBidPrice([dd]), bid0);
  });

  it("simulateOrder reports multi-level VWAP and remainder", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;
    const dd = config.deliveryDates[0];
    const step = config.priceLadderStep;

    const askLo = parseUnits("100", 6);
    const askHi = askLo + step;
    const buyLimit = askHi;

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });

    await futures.write.createOrder([askLo, dd, -1n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([askHi, dd, -1n, TimeInForce.GTC], { account: seller.account });

    const [filled, avg, remaining] = await futures.read.simulateOrder([dd, buyLimit, 3n], {
      account: buyer.account,
    });

    assert.equal(filled, 2n);
    assert.equal(remaining, 1n);
    assert.equal(avg, (askLo + askHi) / 2n);
  });
});
