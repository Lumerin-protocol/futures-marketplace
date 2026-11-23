import { expect, test } from "../src/fixtures";
import { SKIP } from "../src/skips";

// Smoke manual §1 "First look". No wallet is connected here; the mock wallet is
// installed but never authorized, as for a visitor with a wallet extension.
test.describe("first look", () => {
  test("futures page renders every area without errors", async ({ trading, consoleErrors, env }) => {
    await trading.open("futures");

    await expect(trading.page).toHaveTitle("HPDX");
    await expect(trading.brand).toBeVisible();
    await expect(trading.market.trigger).toContainText(/— \d{1,2} [A-Z][a-z]{2} \d{4}/);
    // The manual's ticker list (Funding Rate, Total Volume) is the perpetual one; futures shows Contract Size.
    await expect(trading.stat(/^Hash Price/)).toBeVisible();
    await expect(trading.stat("Contract Size")).toBeVisible();
    await expect(trading.stat(/^View Details/)).toBeVisible();
    for (const range of ["1D", "5D", "1M"]) await expect(trading.chartRange(range)).toBeVisible();
    await expect(trading.balance.root).toBeVisible();
    for (const control of ["Limit", "Market", "Bid", "Ask"]) await expect(trading.ticket.button(control)).toBeVisible();
    await trading.header.expectDisconnected();

    if (env.subgraph) {
      const top = await trading.book.waitForTwoSidedBook();
      expect(top.bestBid, "best bid sits below best ask").toBeLessThan(top.bestAsk);
    }
    expect(consoleErrors.blocking, "uncaught errors or failed contract reads").toEqual([]);
  });

  test("market selector lists the perp and futures expirations and switches venue", async ({
    trading,
    consoleErrors,
    env,
  }) => {
    test.skip(SKIP.noPerps.when, SKIP.noPerps.reason);
    await trading.open("futures");

    const listed = await trading.market.listed();
    expect(listed.perpetual, "perpetual row").toBe(1);
    expect(listed.futures, "tradable futures expirations").toBeGreaterThan(0);

    await trading.market.choosePerpetual();
    await expect(trading.stat(/^Funding Rate/)).toBeVisible();
    if (env.subgraph) {
      await expect(trading.stat("Total Volume")).toBeVisible();
      await trading.book.waitForTwoSidedBook();
    }

    await trading.market.chooseFutures(0);
    if (env.subgraph) await trading.book.waitForTwoSidedBook();
    expect(consoleErrors.blocking, "uncaught errors or failed contract reads").toEqual([]);
  });

  test("perpetual route opens directly", async ({ trading, consoleErrors }) => {
    test.skip(SKIP.noPerps.when, SKIP.noPerps.reason);
    await trading.open("perpetual");
    await expect(trading.market.trigger).toContainText("— Perp");
    await expect(trading.ticket.button("Bid")).toBeVisible();
    expect(consoleErrors.blocking, "uncaught errors or failed contract reads").toEqual([]);
  });
});
