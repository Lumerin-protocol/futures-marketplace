import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseEventLogs, parseUnits } from "viem";
import { deployFuturesFixture, type FuturesFixture } from "./fixtures.ts";
import { quantizePrice, refreshHashprice, scaleHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

// Opens a matched lot (seller short / buyer long) at `entryPrice` on the first delivery
// date between the given short/long accounts. Returns the lot id.
async function openLotBetween(
  data: FuturesFixture,
  short: FuturesFixture["accounts"]["seller"],
  long: FuturesFixture["accounts"]["buyer"],
  entryPrice: bigint,
  deliveryDate: bigint,
) {
  const { futures } = data.contracts;
  const { pc } = data.accounts;
  await futures.write.createOrder([entryPrice, deliveryDate, "", -1], { account: short.account });
  const txHash = await futures.write.createOrder([entryPrice, deliveryDate, "", 1], {
    account: long.account,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  const [created] = parseEventLogs({ logs: receipt.logs, abi: futures.abi, eventName: "LotCreated" });
  return created.args.lotId;
}

describe("Futures settlement price (pinned)", () => {
  it("recordSettlementPrice reverts before the expiration has matured", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = data.contracts;
    const { buyer } = data.accounts;
    const deliveryDate = data.config.deliveryDates[0];

    await viem.assertions.revertWithCustomError(
      futures.write.recordSettlementPrice([deliveryDate], { account: buyer.account }),
      futures,
      "SettlementDateNotReached",
    );
  });

  it("recordSettlementPrice pins the live oracle price once and emits the event", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts } = data;
    const { futures, hashrateOracle } = contracts;
    const { buyer2, tc, pc } = accounts;
    const deliveryDate = data.config.deliveryDates[0];

    await refreshHashprice(hashrateOracle, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });

    const txHash = await futures.write.recordSettlementPrice([deliveryDate], {
      account: buyer2.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const [recorded] = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "SettlementPriceRecorded",
    });

    // Read the live mark only after the tx has mined at maturity (oracle is fresh there).
    const expected = await futures.read.getMarketPrice();
    assert.equal(recorded.args.deliveryAt, deliveryDate);
    assert.equal(recorded.args.price, expected);
    assert.equal(getAddress(recorded.args.recordedBy), getAddress(buyer2.account.address));
    assert.equal(await futures.read.settlementPrice([deliveryDate]), expected);
  });

  it("is set-once: a later record does not overwrite even after the oracle moves", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts } = data;
    const { futures, hashrateOracle } = contracts;
    const { buyer2, tc } = accounts;
    const deliveryDate = data.config.deliveryDates[0];

    await refreshHashprice(hashrateOracle, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    await futures.write.recordSettlementPrice([deliveryDate], { account: buyer2.account });
    const pinned = await futures.read.settlementPrice([deliveryDate]);

    // Move the oracle well away and refresh freshness, then record again.
    await scaleHashprice(hashrateOracle, 2n, 1n);
    await refreshHashprice(hashrateOracle);
    await futures.write.recordSettlementPrice([deliveryDate], { account: buyer2.account });

    assert.equal(await futures.read.settlementPrice([deliveryDate]), pinned);
    assert.notEqual(await futures.read.getMarketPrice(), pinned);
  });

  it("recordSettlementPrice reverts OracleStale when the feed is stale", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures } = data.contracts;
    const { buyer2, tc } = data.accounts;
    const deliveryDate = data.config.deliveryDates[0];

    // Warp to maturity WITHOUT refreshing the oracle: the fixture answer is now hours old.
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    await viem.assertions.revertWithCustomError(
      futures.write.recordSettlementPrice([deliveryDate], { account: buyer2.account }),
      futures,
      "OracleStale",
    );
  });

  it("settlePosition lazily pins the price (no prior record) and emits the event", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, hashrateOracle } = contracts;
    const { seller, buyer, buyer2, tc, pc } = accounts;
    const deliveryDate = config.deliveryDates[0];
    const entryPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);

    await contracts.collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await contracts.collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });
    const lotId = await openLotBetween(data, seller, buyer, entryPrice, deliveryDate);

    await refreshHashprice(hashrateOracle, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });

    assert.equal(await futures.read.settlementPrice([deliveryDate]), 0n);
    const txHash = await futures.write.settlePosition([lotId], { account: buyer2.account });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
    const recorded = parseEventLogs({
      logs: receipt.logs,
      abi: futures.abi,
      eventName: "SettlementPriceRecorded",
    });

    assert.equal(recorded.length, 1);
    assert.notEqual(await futures.read.settlementPrice([deliveryDate]), 0n);
  });

  it("two positions on the same expiry settle at one price despite the oracle moving between txs", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, collateralVault, hashrateOracle } = contracts;
    const { seller, buyer, buyer2, tc, pc } = accounts;
    const deliveryDate = config.deliveryDates[0];
    const entryPrice = quantizePrice(parseUnits("100", 6), config.priceLadderStep);
    const days = BigInt(config.deliveryDurationDays);

    const margin = parseUnits("10000", 6);
    for (const a of [seller, buyer, buyer2]) {
      await collateralVault.write.deposit([margin], { account: a.account });
    }

    // Two lots sharing `seller` as the short side; `buyer` and `buyer2` are the longs. Same
    // price + date, so both longs must realize identical PnL at the pinned settlement price.
    const lotA = await openLotBetween(data, seller, buyer, entryPrice, deliveryDate);
    const lotB = await openLotBetween(data, seller, buyer2, entryPrice, deliveryDate);

    // Reach maturity and pin the price.
    await refreshHashprice(hashrateOracle, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    await futures.write.recordSettlementPrice([deliveryDate], { account: buyer.account });
    const pinned = await futures.read.settlementPrice([deliveryDate]);

    // Move the oracle, then settle lot A.
    await scaleHashprice(hashrateOracle, 12n, 10n);
    await refreshHashprice(hashrateOracle);
    const rA = await pc.waitForTransactionReceipt({
      hash: await futures.write.settlePosition([lotA], { account: buyer.account }),
    });
    const [closedA] = parseEventLogs({ logs: rA.logs, abi: futures.abi, eventName: "LotClosed" });

    // Move the oracle again, then settle lot B.
    await scaleHashprice(hashrateOracle, 8n, 10n);
    await refreshHashprice(hashrateOracle);
    const rB = await pc.waitForTransactionReceipt({
      hash: await futures.write.settlePosition([lotB], { account: buyer.account }),
    });
    const [closedB] = parseEventLogs({ logs: rB.logs, abi: futures.abi, eventName: "LotClosed" });

    // Both longs realize identical PnL computed at the pinned price, not the moving live mark.
    const expectedLongPnl = (pinned - entryPrice) * days;
    assert.equal(closedA.args.buyerPnl, expectedLongPnl);
    assert.equal(closedB.args.buyerPnl, expectedLongPnl);
    assert.equal(closedA.args.buyerPnl, closedB.args.buyerPnl);
  });

  it("a pinned settlement price does not affect the live getMarketPrice (liquidation mark)", async () => {
    const data = await networkHelpers.loadFixture(deployFuturesFixture);
    const { contracts, accounts, config } = data;
    const { futures, hashrateOracle } = contracts;
    const { buyer2, tc } = accounts;
    const deliveryDate = config.deliveryDates[0];

    await refreshHashprice(hashrateOracle, deliveryDate);
    await tc.setNextBlockTimestamp({ timestamp: deliveryDate });
    await futures.write.recordSettlementPrice([deliveryDate], { account: buyer2.account });
    const pinned = await futures.read.settlementPrice([deliveryDate]);

    await scaleHashprice(hashrateOracle, 3n, 2n);
    await refreshHashprice(hashrateOracle);

    // The live mark (used by liquidation's _settleAtMark) tracks the oracle, not the pin.
    assert.notEqual(await futures.read.getMarketPrice(), pinned);
  });
});
