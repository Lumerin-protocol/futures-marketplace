import { expect, type Locator, type Page } from "@playwright/test";
import { TESTIDS } from "../testids";

/** How long a whole multistep transaction may take on a public testnet. */
export const TX_TIMEOUT = 180_000;

/**
 * A `TransactionForm` (ui/src/components/Forms/Shared/MultistepForm.tsx) in a
 * modal: review → wallet steps → result. Every form in the app is one, so the
 * deposit, order, cancel and close modals are this plus their own fields.
 */
export class TransactionModal {
  readonly root: Locator;

  constructor(
    protected readonly page: Page,
    /** The form's title, which every step renders as its heading. */
    readonly title: string,
  ) {
    this.root = page
      .getByTestId(TESTIDS.modal)
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  }

  button(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }

  async expectOpen(): Promise<void> {
    await expect(this.root).toBeVisible();
  }

  /** Presses the review step's primary button and waits for every wallet step to finish. */
  async execute(executeLabel = "Execute"): Promise<void> {
    await this.button(executeLabel).click();
    await this.waitForSuccess();
  }

  /** Resolves once the result screen ("Okay") is up; throws with the UI's error text if a step failed. */
  async waitForSuccess(timeout = TX_TIMEOUT): Promise<void> {
    const failed = this.root.getByText("Failed", { exact: true });
    await expect(this.button("Okay").or(failed).first()).toBeVisible({ timeout });
    if (await failed.isVisible()) await this.throwStepError();
  }

  /**
   * How a wallet step ended, as its progress row reads: "Transaction successful",
   * "Success" (an off-chain step such as a permit signature), "Skipped" or "Failed".
   */
  async stepOutcome(stepLabel: string): Promise<string> {
    const text = await this.root.getByText(stepLabel, { exact: true }).last().locator("xpath=..").innerText();
    return text.match(/Transaction successful|Success|Skipped|Failed/)?.[0] ?? text.trim();
  }

  async throwStepError(): Promise<never> {
    const details = this.root.getByRole("button", { name: "Show Details" });
    if (await details.count()) await details.first().click();
    const text = (await this.root.innerText()).replace(/\n{2,}/g, "\n");
    throw new Error(`"${this.title}" failed in the UI:\n${text}`);
  }

  async close(): Promise<void> {
    await this.button("Okay").click();
    await expect(this.root).toBeHidden();
  }
}
