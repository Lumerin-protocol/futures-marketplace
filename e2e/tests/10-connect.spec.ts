import { expect, test } from "../src/fixtures";

// Smoke manual §2 Option A: an injected browser wallet, here the mock wallet.
// No transaction is sent, so this runs with a throwaway key when no funded one is configured.
test.describe("connect wallet", () => {
  test("connects through AppKit and loads the account", async ({ trading, wallet, consoleErrors }) => {
    await trading.open("futures");
    await trading.connect();

    await expect(trading.header.chainButton).toHaveText(wallet.signer.chain.name);
    await expect(trading.header.connectorIcon).toBeVisible();
    for (const metric of ["equity", "unrealizedPnl", "marginUsed", "available"] as const) {
      await trading.balance.read(metric);
    }
    for (const tab of ["Open Orders", "Positions", "Trades", "Position History", "Order History"] as const) {
      await expect(trading.tables.tab(tab)).toBeVisible();
    }
    expect(wallet.pageTransactions(), "connecting must not send transactions").toEqual([]);
    expect(consoleErrors.blocking, "uncaught errors or failed contract reads").toEqual([]);
  });

  test("stays connected across a reload", async ({ trading }) => {
    await trading.openConnected("futures");
    await trading.page.reload();
    await trading.waitUntilReady();
    await trading.header.expectConnected(trading.wallet.address);
    await expect(trading.tables.tab("Open Orders")).toBeVisible();
  });

  test("disconnects and connects again", async ({ trading }) => {
    await trading.openConnected("futures");
    await trading.header.disconnect();
    await expect(trading.tables.tab("Open Orders")).toBeHidden();
    await trading.connect();
  });
});
