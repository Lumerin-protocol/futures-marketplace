import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseUnits } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { refreshHashprice } from "./utils.ts";

const { viem, networkHelpers } = await network.getOrCreate();

/**
 * Tests covering the views added for the off-chain market maker:
 *   - getUserOrders(participant)
 *   - getActiveExpirationDates(participant)
 *   - MAX_ORDERS_PER_PARTICIPANT constant
 *   - getBidPrices / getAskPrices / getQuantityAtPrice (per-delivery-date depth)
 *
 * Active-price-set maintenance is verified end-to-end by creating, partially
 * cancelling, and fully cancelling orders and asserting the depth views drop
 * the price level when the queue empties.
 */

describe("MM views", () => {
  it("MAX_ORDERS_PER_PARTICIPANT equals 100", async () => {
    const { contracts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const max = await contracts.futures.read.MAX_ORDERS_PER_PARTICIPANT();
    assert.equal(Number(max), 100);
  });

  it("getUserOrders returns the full set of resting orders for a participant", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;
    const deliveryDates = await futures.read.getExpirationDates();
    const dd = deliveryDates[0];

    const p1 = parseUnits("100", 6);
    const p2 = parseUnits("101", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await refreshHashprice(contracts.hashrateOracle);
    // Two separate placements (qty does not merge across createOrder calls).
    await futures.write.createOrder([p1, dd, 1], { account: seller.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([p2, dd, 2], { account: seller.account });

    const ids = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(ids.length, 2, "two resting orders");
  });

  it("getActiveExpirationDates returns positions where caller is buyer or seller", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;
    const deliveryDates = await futures.read.getExpirationDates();
    const dd = deliveryDates[0];
    const price = parseUnits("100", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([price, dd, -1], { account: seller.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([price, dd, 1], { account: buyer.account });

    const sellerIds = await futures.read.getActiveExpirationDates([seller.account.address]);
    const buyerIds = await futures.read.getActiveExpirationDates([buyer.account.address]);
    assert.equal(sellerIds.length, 1);
    assert.equal(buyerIds.length, 1);
    assert.equal(sellerIds[0], buyerIds[0]);
  });

  it("getBidPrices/getAskPrices include each active price exactly once", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;
    const dd = (await futures.read.getExpirationDates())[0];

    const ask1 = parseUnits("100", 6);
    const ask2 = parseUnits("101", 6);
    const bid1 = parseUnits("99", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: buyer.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([ask1, dd, -1], { account: seller.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([ask1, dd, -1], { account: seller.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([ask2, dd, -1], { account: seller.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([bid1, dd, 1], { account: buyer.account });

    const asks = [...(await futures.read.getAskPrices([dd, 50n]))].sort((a, b) => Number(a - b));
    const bids = [...(await futures.read.getBidPrices([dd, 50n]))].sort((a, b) => Number(a - b));
    assert.deepEqual(asks, [ask1, ask2]);
    assert.deepEqual(bids, [bid1]);

    // getOrderBookPrices must match the split getters (same expirationAt + depth).
    const [bookBids, bookAsks] = await futures.read.getOrderBookPrices([dd, 50n]);
    assert.deepEqual([...bookAsks].sort((a, b) => Number(a - b)), asks);
    assert.deepEqual([...bookBids].sort((a, b) => Number(a - b)), bids);

    assert.equal(await futures.read.getQuantityAtPrice([dd, ask1, false]), 2n);
    assert.equal(await futures.read.getQuantityAtPrice([dd, ask2, false]), 1n);
    assert.equal(await futures.read.getQuantityAtPrice([dd, bid1, true]), 1n);
  });

  it("active-price set drops the level once the last order at it closes", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller } = accounts;
    const dd = (await futures.read.getExpirationDates())[0];
    const price = parseUnits("100", 6);

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([price, dd, -1], { account: seller.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([price, dd, -1], { account: seller.account });

    let asks = await futures.read.getAskPrices([dd, 50n]);
    assert.equal(asks.length, 1);
    assert.equal(await futures.read.getQuantityAtPrice([dd, price, false]), 2n);

    const ids = await futures.read.getUserOrders([seller.account.address]);
    assert.equal(ids.length, 2);

    await futures.write.cancelOrder([ids[0]], { account: seller.account });
    asks = await futures.read.getAskPrices([dd, 50n]);
    assert.equal(asks.length, 1, "still one level — second order remains");
    assert.equal(await futures.read.getQuantityAtPrice([dd, price, false]), 1n);

    await futures.write.cancelOrder([ids[1]], { account: seller.account });
    asks = await futures.read.getAskPrices([dd, 50n]);
    assert.equal(asks.length, 0, "level removed once queue empties");
    assert.equal(await futures.read.getQuantityAtPrice([dd, price, false]), 0n);
  });

  it("getNetPositionDelta reports ±1×WAD per contract (no duration multiplier)", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;
    const WAD = 10n ** 18n;
    const dd = (await futures.read.getExpirationDates())[0];
    const price = await futures.read.getMarketPrice();

    await collateralVault.write.deposit([price * 10n], { account: seller.account });
    await collateralVault.write.deposit([price * 10n], { account: buyer.account });

    await futures.write.createOrder([price, dd, -3], { account: seller.account });
    await futures.write.createOrder([price, dd, 3], { account: buyer.account });

    // 3 matched contracts → long buyer +3·WAD, short seller −3·WAD, independent
    // of the (now-removed) delivery-duration multiplier.
    assert.equal(await futures.read.getNetPositionDelta([buyer.account.address]), 3n * WAD);
    assert.equal(await futures.read.getNetPositionDelta([seller.account.address]), -3n * WAD);
  });

  it("cancelOrder rejects callers that don't own the order", async () => {
    const { contracts, accounts } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault } = contracts;
    const { seller, buyer } = accounts;
    const dd = (await futures.read.getExpirationDates())[0];

    await collateralVault.write.deposit([parseUnits("10000", 6)], { account: seller.account });
    await refreshHashprice(contracts.hashrateOracle);
    await futures.write.createOrder([parseUnits("100", 6), dd, -1], { account: seller.account });
    const ids = await futures.read.getUserOrders([seller.account.address]);

    await viem.assertions.revertWithCustomError(
      futures.write.cancelOrder([ids[0]], { account: buyer.account }),
      futures,
      "OrderNotBelongToSender",
    );
  });
});
