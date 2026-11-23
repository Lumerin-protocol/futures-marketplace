import { expect, test } from "../src/fixtures";
import { INDEXER_TIMEOUT } from "../src/pages/AccountTables";
import { SKIP } from "../src/skips";
import { floorToTick } from "../src/utils/numbers";

// Smoke manual §4 "Futures — resting limit order" and §8 "Cancel resting order".
test.describe("resting limit order", () => {
  test.skip(SKIP.noFundedWallet.when, SKIP.noFundedWallet.reason);
  test.skip(SKIP.noSubgraph.when, SKIP.noSubgraph.reason);

  test.beforeAll(async ({ protocol, env }) => {
    await protocol.ensureCollateral(env.amounts.minCollateral);
  });

  test.afterEach(async ({ trading }, testInfo) => {
    // A failed run may have left the bid resting; the next spec expects a flat account.
    if (testInfo.status !== testInfo.expectedStatus) await trading.flatten();
  });

  test("a GTC bid below the book rests, shows everywhere, and cancels cleanly", async ({ trading, protocol, env }) => {
    const qty = env.amounts.orderQty;
    await trading.flatten();
    const tick = await protocol.priceTick();
    const { bestBid } = await trading.book.waitForTwoSidedBook();
    // A few percent under the best bid: well clear of the market maker, so it rests.
    const price = floorToTick(bestBid * (1 - env.amounts.priceOffsetPct / 100), tick);
    const priceLabel = price.toFixed(2);
    const own = trading.tables.orderRows({ side: "Long", price: priceLabel });

    await trading.tables.open("Open Orders");
    const ordersBefore = await trading.tables.orderRows().count();
    const levelBefore = await trading.book.quantityAt(price);
    const marginBefore = await trading.balance.read("marginUsed");

    await test.step("place", async () => {
      const result = await trading.placeOrder({
        side: "bid",
        type: "limit",
        timeInForce: "GTC",
        price: priceLabel,
        quantity: qty,
      });
      expect(result.outcome).toBe("Resting on the book");
      expect(result.detail).toBe("Waiting on the book to be matched");
      expect(result.fee, "nothing filled, nothing charged").toBe(0);
    });

    await test.step("Open Orders, order book and margin show it", async () => {
      await expect(own).toHaveCount(1, { timeout: INDEXER_TIMEOUT });
      await expect(own.getByRole("cell", { name: `0 / ${qty}`, exact: true })).toBeVisible();
      await expect(trading.tables.orderRows()).toHaveCount(ordersBefore + 1);
      await expect(trading.tables.tab("Open Orders")).toHaveAccessibleName(`Open Orders ${ordersBefore + 1}`);
      await expect
        .poll(() => trading.book.quantityAt(price), { message: `book level ${priceLabel}`, timeout: INDEXER_TIMEOUT })
        .toBeGreaterThanOrEqual(levelBefore + qty);
      await expect
        .poll(async () => (await trading.balance.peek("marginUsed")) ?? marginBefore, {
          message: "Margin Used rises",
          timeout: INDEXER_TIMEOUT,
        })
        .toBeGreaterThan(marginBefore);
    });

    await test.step("cancel", async () => {
      await trading.tables.cancelOrder(own);
      await expect(own).toHaveCount(0, { timeout: INDEXER_TIMEOUT });
      await expect(trading.tables.orderRows()).toHaveCount(ordersBefore);
      await expect
        .poll(() => trading.book.quantityAt(price), { message: `book level ${priceLabel}`, timeout: INDEXER_TIMEOUT })
        .toBeLessThanOrEqual(levelBefore);
      await trading.balance.expectValue("marginUsed", marginBefore, 0.01);
    });
  });
});
