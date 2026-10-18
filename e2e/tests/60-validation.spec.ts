import { expect, test } from "../src/fixtures";

// Smoke manual §9 "Zero size … blocked in UI" and §10 "over-withdraw blocked",
// plus the ticket's margin gate. A fresh wallet with nothing in it is refused
// by every form, and nothing ever reaches the wallet.
test.describe("validation without funds", () => {
  test.use({ walletKind: "throwaway" });

  test.beforeEach(async ({ trading }) => {
    await trading.openConnected("futures");
  });

  test("the ticket refuses a bid it cannot margin and a zero quantity", async ({ trading, wallet }) => {
    const price = await trading.ticket.marketPrice();
    await trading.ticket.fill({ side: "bid", type: "limit", timeInForce: "GTC", price, quantity: 1 });
    await trading.ticket.waitUntilQuoted();
    await trading.ticket.press("bid");
    await trading.alert.expectMessage("Insufficient funds for this bid.");
    await trading.alert.accept();

    await trading.ticket.fill({ side: "ask", type: "limit", timeInForce: "GTC", price, quantity: 0 });
    await trading.ticket.press("ask");
    await trading.alert.expectMessage("Quantity must be greater than 0");
    await trading.alert.accept();

    expect(wallet.pageTransactions(), "transactions sent").toEqual([]);
  });

  test("deposit and withdraw refuse more than the wallet and the vault hold", async ({ trading, wallet }) => {
    const deposit = await trading.balance.openDeposit();
    expect(await deposit.readSummary("Available balance:"), "wallet USDC").toBe(0);
    await deposit.enterAmount(1);
    await deposit.button("Execute").click();
    await expect(deposit.fieldError).toContainText("Insufficient balance. Available:");
    await deposit.dismiss();

    const withdraw = await trading.balance.openWithdraw();
    expect(await withdraw.readSummary("Total balance:"), "vault USDC").toBe(0);
    await withdraw.enterAmount(1);
    await withdraw.button("Execute").click();
    await expect(withdraw.fieldError).toContainText("Insufficient balance. Available:");
    await withdraw.dismiss();

    expect(wallet.pageTransactions(), "transactions sent").toEqual([]);
  });
});
