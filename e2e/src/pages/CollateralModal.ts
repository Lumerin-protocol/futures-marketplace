import { expect, type Locator, type Page } from "@playwright/test";
import { tryParseAmount } from "../utils/numbers";
import { typeInto } from "./inputs";
import { TransactionModal } from "./TransactionModal";

const FORMS = {
  deposit: { title: "Deposit Collateral", field: "Deposit Amount" },
  withdraw: { title: "Withdraw Collateral", field: "Withdrawal Amount" },
} as const;

/** The balance lines under the amount: the deposit form shows the wallet, the withdraw form the vault. */
export type CollateralSummary = "Available balance:" | "Total balance:" | "Locked:";

/** DepositForm / WithdrawalForm: an amount on the review step, then Authorize (deposit only) and the transfer. */
export class CollateralModal extends TransactionModal {
  readonly amount: Locator;
  readonly max: Locator;
  /** The field's validation message, e.g. "Insufficient balance. Available: 3.20 USDC". */
  readonly fieldError: Locator;

  constructor(page: Page, kind: keyof typeof FORMS) {
    super(page, FORMS[kind].title);
    this.amount = this.root.getByLabel(FORMS[kind].field, { exact: true });
    this.max = this.button("Max");
    this.fieldError = this.root.getByText(/must be a positive number|Insufficient balance|Unable to fetch/);
  }

  /** A balance line, once it has loaded ("Loading..." and "..." are placeholders). */
  async readSummary(line: CollateralSummary): Promise<number> {
    const value = this.root.getByText(line, { exact: true }).locator("xpath=following-sibling::*[1]");
    let last: number | undefined;
    await expect
      .poll(
        async () => {
          last = tryParseAmount(await value.textContent());
          return last;
        },
        { message: `"${line}" never loaded` },
      )
      .not.toBeUndefined();
    return last as number;
  }

  async enterAmount(usdc: number): Promise<void> {
    await typeInto(this.amount, usdc.toFixed(2));
    // The field validates on blur and adds or drops its message, which moves the buttons
    // below it; blurring first keeps the next click from landing where Execute used to be.
    await this.amount.blur();
  }

  async submit(usdc: number): Promise<void> {
    await this.enterAmount(usdc);
    await expect(this.fieldError).toBeHidden();
    await this.execute("Execute");
  }

  /** Leaves the form from its first step without sending anything. */
  async dismiss(): Promise<void> {
    await this.button("Back").click();
    await expect(this.root).toBeHidden();
  }
}
