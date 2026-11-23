import type { Locator } from "@playwright/test";
import { expect, test } from "../src/fixtures";
import { INDEXER_TIMEOUT } from "../src/pages/AccountTables";
import type { TradingPage } from "../src/pages/TradingPage";
import { SKIP } from "../src/skips";
import { floorToTick } from "../src/utils/numbers";

// Smoke manual §4 and §11 step 2: one small GTC bid under the book on the perp,
// one on the nearest futures expiration. Each rests, shows in Open Orders and is
// cancelled again, so neither test leaves an order or a position behind.
test.describe("an order on each venue", () => {
  test.skip(SKIP.noFundedWallet.when, SKIP.noFundedWallet.reason);
  test.skip(SKIP.noSubgraph.when, SKIP.noSubgraph.reason);

  test.beforeAll(async ({ protocol, env }) => {
    await protocol.ensureCollateral(env.amounts.minCollateral);
  });

  test.afterEach(async ({ trading }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    await trading.flatten("perpetual");
    await trading.flatten("futures");
  });

  test("perpetual: a GTC bid rests in Open Orders and cancels", async ({ trading, protocol, env }) => {
    test.skip(SKIP.noPerps.when, SKIP.noPerps.reason);
    test.setTimeout(300_000);
    const qty = env.amounts.orderQty;
    await trading.flatten("perpetual");
    await expect(trading.market.trigger).toContainText("Hashprice/USDC — Perp");

    const tick = await protocol.priceTick("perpetual");
    const { row, price, ordersBefore } = await restBid(trading, tick, env.amounts.priceOffsetPct, qty);
    // Perps print an order's size as notional: filled / total USDC.
    const notional = (Number(price) * qty).toFixed(2);
    await expect(row.getByRole("cell", { name: `0.00 / ${notional}`, exact: true })).toBeVisible();

    await cancelAndExpectGone(trading, row, ordersBefore);
  });

  test("futures, nearest expiration: a GTC bid rests in Open Orders and cancels", async ({
    trading,
    protocol,
    env,
  }) => {
    test.setTimeout(300_000);
    const qty = env.amounts.orderQty;
    await trading.flatten("futures");
    const expiry = await trading.market.chooseNearestFutures();

    const tick = await protocol.priceTick("futures");
    const { row, ordersBefore } = await restBid(trading, tick, env.amounts.priceOffsetPct, qty);
    await expect(row.getByRole("cell", { name: `0 / ${qty}`, exact: true })).toBeVisible();
    expect(await trading.tables.orderExpiration(row), "the order's Contract Expiration").toBe(expiry);

    await cancelAndExpectGone(trading, row, ordersBefore);
  });
});

/** Places a GTC bid E2E_PRICE_OFFSET_PCT under the best bid; returns its Open Orders row once it shows. */
async function restBid(trading: TradingPage, tick: number, offsetPct: number, quantity: number) {
  const { bestBid } = await trading.book.waitForTwoSidedBook();
  const price = floorToTick(bestBid * (1 - offsetPct / 100), tick).toFixed(2);
  await trading.tables.open("Open Orders");
  const ordersBefore = await trading.tables.orderRows().count();

  const result = await trading.placeOrder({ side: "bid", type: "limit", timeInForce: "GTC", price, quantity });
  expect(result.outcome).toBe("Resting on the book");
  expect(result.detail).toBe("Waiting on the book to be matched");

  const row = trading.tables.orderRows({ side: "Long", price });
  await expect(row).toHaveCount(1, { timeout: INDEXER_TIMEOUT });
  await expect(trading.tables.tab("Open Orders")).toHaveAccessibleName(`Open Orders ${ordersBefore + 1}`);
  return { row, price, ordersBefore };
}

async function cancelAndExpectGone(trading: TradingPage, row: Locator, ordersBefore: number) {
  await trading.tables.cancelOrder(row);
  await expect(row).toHaveCount(0, { timeout: INDEXER_TIMEOUT });
  await expect(trading.tables.tab("Open Orders")).toHaveAccessibleName(`Open Orders ${ordersBefore}`);
}
