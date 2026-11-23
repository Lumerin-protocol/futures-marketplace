import { expect, type Locator, type Page } from "@playwright/test";
import { TESTIDS } from "../testids";
import { tryParseAmount } from "../utils/numbers";
import { CollateralModal } from "./CollateralModal";

export type BalanceMetric = Exclude<keyof typeof TESTIDS.balance, "widget">;

/** Balances refresh on a poll after each transaction, so expectations on them wait this long. */
const BALANCE_TIMEOUT = 90_000;

/** "Account Portfolio (USDC)" in the right panel (FuturesBalanceWidget). */
export class BalanceWidget {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByTestId(TESTIDS.balance.widget);
  }

  value(metric: BalanceMetric): Locator {
    return this.page.getByTestId(TESTIDS.balance[metric]);
  }

  /** The figure on screen right now; undefined while it is loading or refetching. */
  async peek(metric: BalanceMetric): Promise<number | undefined> {
    const value = this.value(metric);
    if ((await value.locator('[aria-busy="true"]').count()) > 0) return undefined;
    return tryParseAmount(await value.textContent());
  }

  /** Waits for a settled figure and returns it. */
  async read(metric: BalanceMetric): Promise<number> {
    let last: number | undefined;
    await expect
      .poll(
        async () => {
          last = await this.peek(metric);
          return last;
        },
        { message: `"${metric}" never showed a number`, timeout: BALANCE_TIMEOUT },
      )
      .not.toBeUndefined();
    return last as number;
  }

  /** Waits until `metric` reads `expected` within `tolerance`. */
  async expectValue(metric: BalanceMetric, expected: number, tolerance = 0.01): Promise<void> {
    await expect
      .poll(async () => Math.abs(((await this.peek(metric)) ?? Number.NaN) - expected), {
        message: `"${metric}" should reach ${expected.toFixed(2)} ± ${tolerance}`,
        timeout: BALANCE_TIMEOUT,
      })
      .toBeLessThanOrEqual(tolerance + 1e-9);
  }

  async openDeposit(): Promise<CollateralModal> {
    await this.root.getByRole("button", { name: "Deposit", exact: true }).click();
    const modal = new CollateralModal(this.page, "deposit");
    await modal.expectOpen();
    return modal;
  }

  async openWithdraw(): Promise<CollateralModal> {
    await this.root.getByRole("button", { name: "Withdraw", exact: true }).click();
    const modal = new CollateralModal(this.page, "withdraw");
    await modal.expectOpen();
    return modal;
  }
}
