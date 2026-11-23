import { expect, type Locator, type Page } from "@playwright/test";
import { parseAmount, tryParseAmount } from "../utils/numbers";
import { TX_TIMEOUT, TransactionModal } from "./TransactionModal";

export type OrderOutcome =
  | "Filled"
  | "Resting on the book"
  | "Partially filled"
  | "Partially filled, rest cancelled"
  | "Nothing new placed";

const OUTCOMES = /^(Filled|Resting on the book|Partially filled|Partially filled, rest cancelled|Nothing new placed)$/;

/** What the result screen says the receipt did. */
export interface OrderResult {
  outcome: OrderOutcome;
  /** e.g. "Matched immediately as taker", "Waiting on the book to be matched". */
  detail: string | undefined;
  /** Average fill price, when anything filled. */
  fillPrice: number | undefined;
  /** "Fee charged" (positive) or "Fee rebate" (negative); 0 when nothing filled. */
  fee: number;
  /** The "Position" row, e.g. "Long 1". */
  position: string | undefined;
}

/**
 * PlaceOrderForm in its modal: the review of a Bid/Ask, then the wallet step,
 * then the result. Closing a position reuses it under the title "Close Position".
 */
export class OrderModal extends TransactionModal {
  // biome-ignore lint/complexity/noUselessConstructor: narrows `title` to the titles PlaceOrderForm renders.
  constructor(page: Page, title: "Place Bid Order" | "Place Ask Order" | "Close Position") {
    super(page, title);
  }

  /** The review screen's figure next to `label`, e.g. "Margin required". */
  row(label: string): Locator {
    return this.root.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]");
  }

  /** Confirms the order and returns the result once the account figures have caught up with the receipt. */
  async place(): Promise<OrderResult> {
    await this.execute(this.title);
    return this.result();
  }

  async result(): Promise<OrderResult> {
    // The headline is decoded from the receipt; "Your account now" reads "Updating…" until the
    // indexer has passed that block, and the step flips to Failed if it never does.
    const failed = this.root.getByText("Failed", { exact: true });
    const updating = this.root.getByText("Updating…", { exact: true });
    await expect
      .poll(
        async () => ((await failed.isVisible()) ? "failed" : (await updating.count()) === 0 ? "settled" : "pending"),
        { message: `"${this.title}" result never settled`, timeout: TX_TIMEOUT },
      )
      .not.toBe("pending");
    if (await failed.isVisible()) await this.throwStepError();

    const outcome = (await this.root.getByText(OUTCOMES).first().innerText()).trim() as OrderOutcome;
    const detail = this.root.getByText(/^(Matched immediately as taker|Part matched immediately as taker|Waiting on the book to be matched)$/);
    const headline = await this.root.innerText();
    const fill = headline.match(/@\s*(\d+(?:\.\d+)?)\s*USDC(?:\s*avg)?/);
    const charged = this.root.getByText(/^Fee (charged|rebate)$/);
    const position = this.row("Position");
    let fee = 0;
    if (await charged.count()) {
      const label = await charged.first().innerText();
      const value = parseAmount(await charged.first().locator("xpath=following-sibling::*[1]").innerText());
      fee = label.includes("rebate") ? -value : value;
    }
    return {
      outcome,
      detail: (await detail.count()) ? (await detail.first().innerText()).trim() : undefined,
      fillPrice: outcome === "Resting on the book" || !fill ? undefined : tryParseAmount(fill[1]),
      fee,
      position: (await position.count()) ? (await position.first().innerText()).trim() : undefined,
    };
  }
}
