import { expect, test } from "../src/fixtures";
import { INDEXER_TIMEOUT } from "../src/pages/AccountTables";
import { SKIP } from "../src/skips";
import { floorToTick } from "../src/utils/numbers";

// The account tables' order actions: Modify, "Cancel all" and "Close all".
test.describe("order management", () => {
  test.skip(SKIP.noFundedWallet.when, SKIP.noFundedWallet.reason);
  test.skip(SKIP.noSubgraph.when, SKIP.noSubgraph.reason);

  test.beforeAll(async ({ protocol, env }) => {
    await protocol.ensureCollateral(env.amounts.minCollateral);
  });

  test.afterEach(async ({ trading }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) await trading.flatten();
  });

  test("Modify moves a resting bid and Cancel all removes every bid", async ({ trading, protocol, env }) => {
    test.setTimeout(360_000);
    const qty = env.amounts.orderQty;
    await trading.flatten();
    const tick = await protocol.priceTick();
    const { bestBid } = await trading.book.waitForTwoSidedBook();
    // Distinct levels under the book: E2E_PRICE_OFFSET_PCT × 1, × 2 and × 1.5.
    const below = (times: number) =>
      floorToTick(bestBid * (1 - (env.amounts.priceOffsetPct * times) / 100), tick).toFixed(2);
    const [first, moved, second] = [below(1), below(2), below(1.5)];
    const bid = (price: string) => ({ side: "bid", type: "limit", timeInForce: "GTC", price, quantity: qty }) as const;

    await test.step(`rest a bid at ${first} and move it to ${moved}`, async () => {
      expect((await trading.placeOrder(bid(first))).outcome).toBe("Resting on the book");
      await trading.tables.open("Open Orders");
      const original = trading.tables.orderRows({ side: "Long", price: first });
      await expect(original).toHaveCount(1, { timeout: INDEXER_TIMEOUT });

      await trading.tables.modifyOrder(original, { price: moved });
      const modified = trading.tables.orderRows({ side: "Long", price: moved });
      await expect(modified).toHaveCount(1, { timeout: INDEXER_TIMEOUT });
      await expect(modified.getByRole("cell", { name: `0 / ${qty}`, exact: true })).toBeVisible();
      await expect(original).toHaveCount(0);
    });

    await test.step("Cancel all clears both bids", async () => {
      expect((await trading.placeOrder(bid(second))).outcome).toBe("Resting on the book");
      await expect(trading.tables.orderRows()).toHaveCount(2, { timeout: INDEXER_TIMEOUT });
      expect(await trading.tables.cancelAll(), '"Cancel all" was offered').toBe(true);
      await expect(trading.tables.orderRows()).toHaveCount(0, { timeout: INDEXER_TIMEOUT });
      await expect(trading.tables.tab("Open Orders")).toHaveAccessibleName("Open Orders 0");
    });
  });

  test("Close all flattens a long and cancels the bid resting beside it", async ({ trading, protocol, env }) => {
    test.setTimeout(360_000);
    const qty = env.amounts.orderQty;
    await trading.flatten();
    const tick = await protocol.priceTick();
    const { bestBid } = await trading.book.waitForTwoSidedBook();
    const restingPrice = floorToTick(bestBid * (1 - env.amounts.priceOffsetPct / 100), tick).toFixed(2);

    await test.step("open a long and rest a bid", async () => {
      const fill = await trading.placeOrder({ side: "bid", type: "market", quantity: qty });
      expect(fill.outcome).toBe("Filled");
      const rest = await trading.placeOrder({
        side: "bid",
        type: "limit",
        timeInForce: "GTC",
        price: restingPrice,
        quantity: qty,
      });
      expect(rest.outcome).toBe("Resting on the book");
      await trading.tables.open("Open Orders");
      await expect(trading.tables.orderRows({ side: "Long", price: restingPrice })).toHaveCount(1, {
        timeout: INDEXER_TIMEOUT,
      });
    });

    await test.step("Close all", async () => {
      await trading.tables.open("Positions");
      await expect(trading.tables.positionRows({ side: "Long" })).not.toHaveCount(0, { timeout: INDEXER_TIMEOUT });
      expect(await trading.tables.closeAll(), '"Close all" was offered').toBe(true);
      await expect(trading.tables.positionRows()).toHaveCount(0, { timeout: INDEXER_TIMEOUT });
      await trading.tables.open("Open Orders");
      await expect(trading.tables.orderRows()).toHaveCount(0, { timeout: INDEXER_TIMEOUT });
    });
  });
});
