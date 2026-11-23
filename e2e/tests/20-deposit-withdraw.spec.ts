import { expect, test } from "../src/fixtures";
import { SKIP } from "../src/skips";
import { expectClose, floorToTick } from "../src/utils/numbers";

const AUTHORIZE_PATH: Record<string, string> = {
  Success: "permit signature (EIP-2612), one transaction",
  "Transaction successful": "approve transaction, then deposit",
  Skipped: "existing allowance, deposit only",
};

// Smoke manual §3 "Deposit funds" and §10 "Withdraw". Wallet and vault deltas
// are read on-chain and must be exact; the widget rounds to cents.
test.describe("collateral", () => {
  test.skip(SKIP.noFundedWallet.when, SKIP.noFundedWallet.reason);

  test.beforeEach(async ({ trading, env }) => {
    // Equity equals the vault balance only on a flat account (manual §10: "Prefer flat").
    if (env.subgraph) await trading.flatten();
    else await trading.openConnected("futures");
  });

  test("deposit moves USDC from the wallet into the vault", async ({ trading, protocol, env }) => {
    const amount = env.amounts.deposit;
    const [walletBefore, vaultBefore] = await Promise.all([protocol.walletUsdc(), protocol.vaultUsdc()]);
    expect(walletBefore, `test wallet needs ${amount} USDC to deposit (E2E_DEPOSIT_AMOUNT)`).toBeGreaterThanOrEqual(amount);
    await trading.balance.expectValue("equity", vaultBefore);

    const deposit = await trading.balance.openDeposit();
    expectClose(await deposit.readSummary("Available balance:"), floorToTick(walletBefore, 0.01), 0.001, "wallet USDC in the form");
    await deposit.max.click();
    await expect(deposit.amount).toHaveValue(floorToTick(walletBefore, 0.01).toFixed(2));
    await deposit.submit(amount);
    const authorize = await deposit.stepOutcome("Authorize");
    test.info().annotations.push({ type: "deposit path", description: AUTHORIZE_PATH[authorize] ?? authorize });
    await deposit.close();

    await expect.poll(() => protocol.vaultUsdc(), { timeout: 60_000 }).toBeCloseTo(vaultBefore + amount, 6);
    expect(await protocol.walletUsdc(), "wallet USDC").toBeCloseTo(walletBefore - amount, 6);
    await trading.balance.expectValue("equity", vaultBefore + amount);

    // Manual: hard-refresh, the balance still matches (no double count).
    await trading.page.reload();
    await trading.waitUntilReady();
    await trading.ensureConnected();
    await trading.balance.expectValue("equity", vaultBefore + amount);
  });

  test("withdraw returns USDC to the wallet and refuses more than is free", async ({
    trading,
    protocol,
    wallet,
    env,
  }) => {
    const amount = env.amounts.withdraw;
    await protocol.ensureCollateral(amount);
    const [walletBefore, vaultBefore] = await Promise.all([protocol.walletUsdc(), protocol.vaultUsdc()]);
    await trading.balance.expectValue("equity", vaultBefore);

    const withdraw = await trading.balance.openWithdraw();
    expectClose(await withdraw.readSummary("Total balance:"), vaultBefore, 0.01, "vault USDC in the form");
    const free = await withdraw.readSummary("Available balance:");
    const sentBefore = wallet.pageTransactions().length;
    await withdraw.enterAmount(floorToTick(free, 0.01) + 1);
    await expect(withdraw.fieldError).toContainText("Insufficient balance. Available:");
    await withdraw.button("Execute").click();
    await expect(withdraw.button("Execute"), "still on the amount step").toBeVisible();
    expect(wallet.pageTransactions(), "no transaction for a refused withdrawal").toHaveLength(sentBefore);

    await withdraw.submit(amount);
    await withdraw.close();

    await expect.poll(() => protocol.vaultUsdc(), { timeout: 60_000 }).toBeCloseTo(vaultBefore - amount, 6);
    expect(await protocol.walletUsdc(), "wallet USDC").toBeCloseTo(walletBefore + amount, 6);
    await trading.balance.expectValue("equity", vaultBefore - amount);
  });
});
