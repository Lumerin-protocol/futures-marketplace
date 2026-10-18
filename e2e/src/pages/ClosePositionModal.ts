import { expect, type Page } from "@playwright/test";
import { AlertDialog } from "./AlertDialog";
import { typeInto } from "./inputs";
import { OrderModal } from "./OrderModal";
import { TransactionModal } from "./TransactionModal";

/**
 * ClosePositionForm: Limit or Market for the whole position, then "Review"
 * hands over to the same PlaceOrderForm screens a Bid/Ask uses.
 */
export class ClosePositionModal extends TransactionModal {
  constructor(page: Page) {
    super(page, "Close Position");
  }

  /** Market closes are IOC up to 5% from the mark; a limit close rests at `price` if it does not cross. */
  async review(order: { type: "market" } | { type: "limit"; price: string }): Promise<OrderModal> {
    await this.button(order.type === "market" ? "Market" : "Limit").click();
    if (order.type === "limit") await typeInto(this.root.getByLabel("Price (USDC)", { exact: true }), order.price);
    await this.button("Review").click();

    // Review is refused with an alert when a market close would find nothing to fill.
    const alert = new AlertDialog(this.page);
    const review = new OrderModal(this.page, "Close Position");
    await expect(review.button("Close Position").or(alert.root).first()).toBeVisible();
    if (await alert.root.isVisible()) {
      const message = await alert.message.innerText();
      await alert.accept();
      throw new Error(`Close position was refused: ${message}`);
    }
    return review;
  }
}
