import type { Locator, Page } from "@playwright/test";
import { typeInto } from "./inputs";
import { TransactionModal } from "./TransactionModal";

/**
 * ModifyFuturesOrderModal: new price and quantity, Review, then Execute. A new
 * price is a cancel-and-replace titled "Modify Order"; a same-price shrink is
 * titled "Reduce Order" instead, so this object only covers price changes.
 */
export class ModifyOrderModal extends TransactionModal {
  readonly price: Locator;
  readonly quantity: Locator;

  constructor(page: Page) {
    super(page, "Modify Order");
    this.price = this.root.getByLabel("New Price (USDC)", { exact: true });
    this.quantity = this.root.getByLabel("New Quantity", { exact: true });
  }

  async submit(change: { price: string; quantity?: number }): Promise<void> {
    await typeInto(this.price, change.price);
    if (change.quantity !== undefined) await typeInto(this.quantity, String(change.quantity));
    await this.button("Review").click();
    await this.execute("Execute");
  }
}
