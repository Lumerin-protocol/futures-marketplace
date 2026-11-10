import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { maxUint256 } from "viem";
import { deployFuturesFixture } from "./fixtures.ts";
import { scaleHashprice } from "./utils.ts";
import { TimeInForce } from "./timeInForce.ts";
import { getUserOrders } from "./lib/viewHelpers.ts";

const { networkHelpers } = await network.getOrCreate();

/**
 * CF-021 (High): order price has no upper bound, and the order-liquidation fee computes
 * `price * |qty| * liquidationFeeBps` with checked math. A one-contract ask priced just below
 * 2^256 is accepted for almost no margin but makes every `liquidateOrder(s)` touching it
 * panic. The order stays open, so `liquidatePosition` reverts `OrdersStillOpen` and the
 * account's losses run into the insurance fund.
 *
 * The attack is run in full; the test asserts that the keeper's two steps (cancel orders,
 * then close the position) still liquidate the account. On the unfixed venue both steps
 * revert; once oversized prices are rejected at placement the attack cannot start.
 */
describe("CF-021 — an extreme ask cannot make positions unliquidatable", () => {
  const LIQUIDATION_FEE_BPS = 50;

  it("still liquidates an underwater account that rests an extreme ask", async () => {
    const { contracts, accounts, config } = await networkHelpers.loadFixture(deployFuturesFixture);
    const { futures, collateralVault: vault, hashpriceUsd } = contracts;
    const { owner, seller, buyer, buyer2 } = accounts;
    const expiry = config.deliveryDates[0];
    const tick = config.priceLadderStep;

    const poisonPrice = maxUint256 - (maxUint256 % tick);
    assert.ok(poisonPrice > maxUint256 / BigInt(LIQUIDATION_FEE_BPS), "poison notional overflows the fee");

    await futures.write.setLiquidationFeeBps([LIQUIDATION_FEE_BPS], { account: owner.account });

    const entry = await futures.read.getMarketPrice();
    await vault.write.deposit([entry * 3n], { account: seller.account });
    // Funded below 1x entry so the long stays underwater after a deep hashprice drop.
    await vault.write.deposit([(entry * 4n) / 5n], { account: buyer.account });

    await futures.write.createOrder([entry, expiry, -1n, TimeInForce.GTC], { account: seller.account });
    await futures.write.createOrder([entry, expiry, 1n, TimeInForce.GTC], { account: buyer.account });

    // While healthy, the attacker rests a reducing one-contract ask at the extreme price.
    try {
      await futures.write.createOrder([poisonPrice, expiry, -1n, TimeInForce.GTC], { account: buyer.account });
    } catch {
      // placement rejected — the attack never started
    }

    await scaleHashprice(hashpriceUsd, 1n, 20n);

    // Keeper steps; either may revert on the unfixed venue.
    const orderIds = await getUserOrders(futures, buyer.account.address);
    try {
      if (orderIds.length > 0) {
        await futures.write.liquidateOrders([buyer.account.address, orderIds], { account: buyer2.account });
      }
    } catch {
      // order liquidation reverted
    }
    try {
      await futures.write.liquidatePosition([buyer.account.address, expiry, 1n], { account: buyer2.account });
    } catch {
      // position liquidation reverted
    }

    const position = await futures.read.getUserPosition([buyer.account.address, expiry]);
    assert.equal(position.netQuantity, 0n, "underwater position must be liquidated");
  });
});
