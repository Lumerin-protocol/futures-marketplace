import { expect, test } from "../src/fixtures";
import { INDEXER_TIMEOUT } from "../src/pages/AccountTables";
import { SKIP } from "../src/skips";
import { expectClose } from "../src/utils/numbers";

// Smoke manual §5 "Matching against the market maker", §6 "Positions & PnL"
// and §7 "Exit / close position". One test, because each step needs the last.
test.describe("taker round trip", () => {
  test.skip(SKIP.noFundedWallet.when, SKIP.noFundedWallet.reason);
  test.skip(SKIP.noSubgraph.when, SKIP.noSubgraph.reason);

  test.beforeAll(async ({ protocol, env }) => {
    await protocol.ensureCollateral(env.amounts.minCollateral);
  });

  test.afterEach(async ({ trading }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) await trading.flatten();
  });

  test("a market bid fills against the maker, and closing the long lands in Position History", async ({
    trading,
    protocol,
    env,
  }) => {
    // Four confirmed transactions, each followed by an indexer wait.
    test.setTimeout(420_000);
    const qty = env.amounts.orderQty;
    await trading.flatten();
    const vaultBefore = await protocol.vaultUsdc();
    // Block time against this machine's clock, with room for skew.
    const notBefore = new Date(Date.now() - 120_000);

    const open = await test.step("market bid into the best ask", async () => {
      await trading.book.waitForTwoSidedBook();
      const result = await trading.placeOrder({ side: "bid", type: "market", quantity: qty });
      expect(result.outcome).toBe("Filled");
      expect(result.detail).toBe("Matched immediately as taker");
      expect(result.position).toBe(`Long ${qty}`);
      expect(result.fillPrice, "fill price on the result screen").toBeDefined();
      return { ...result, fillPrice: result.fillPrice as number };
    });

    await test.step("Positions shows the long and the panel its PnL", async () => {
      await trading.tables.open("Positions");
      await expect
        .poll(async () => (await trading.tables.readPositions()).filter((p) => p.side === "Long").length, {
          message: "a Long row in Positions",
          timeout: INDEXER_TIMEOUT,
        })
        .toBeGreaterThan(0);
      const longs = (await trading.tables.readPositions()).filter((p) => p.side === "Long");
      expect(longs.reduce((sum, p) => sum + p.quantity, 0), "long quantity").toBe(qty);
      expect(longs.every((p) => p.status === "Open"), "status Open").toBe(true);
      if (longs.length === 1) expectClose(longs[0].entryPrice, open.fillPrice, 0.01, "entry price");
      await trading.balance.read("unrealizedPnl");
    });

    const close = await test.step("close at market", async () => {
      const result = await trading.tables.closePosition(trading.tables.positionRows({ side: "Long" }).first(), {
        type: "market",
      });
      expect(result.outcome).toBe("Filled");
      expect(result.position).toBe("Flat");
      await expect(trading.tables.positionRows()).toHaveCount(0, { timeout: INDEXER_TIMEOUT });
      expect(result.fillPrice, "fill price on the result screen").toBeDefined();
      return { ...result, fillPrice: result.fillPrice as number };
    });

    await test.step("Position History records the round trip", async () => {
      await trading.tables.open("Position History");
      const entry = await trading.tables.findHistory(
        (row) =>
          row.side === "Long" &&
          row.maxQuantity === qty &&
          row.closedAt !== undefined &&
          row.closedAt >= notBefore &&
          Math.abs(row.entryPrice - open.fillPrice) <= 0.01,
        `the Long ${qty} @ ${open.fillPrice.toFixed(2)} closed in this test`,
      );
      expectClose(entry.exitPrice ?? Number.NaN, close.fillPrice, 0.01, "exit price");
    });

    await test.step("the vault and Equity account for PnL and both fees", async () => {
      // The vault realizes (exit − entry) × qty on close; both legs paid the taker fee.
      const expected = vaultBefore + (close.fillPrice - open.fillPrice) * qty - open.fee - close.fee;
      await expect
        .poll(async () => Math.abs((await protocol.vaultUsdc()) - expected), {
          message: `vault should settle at ${expected.toFixed(4)} USDC`,
          timeout: 60_000,
        })
        .toBeLessThanOrEqual(0.02);
      await trading.balance.expectValue("equity", await protocol.vaultUsdc());
    });
  });
});
