import { expect, type Locator, type Page } from "@playwright/test";
import { TESTIDS } from "../testids";
import { AlertDialog } from "./AlertDialog";
import { typeInto } from "./inputs";
import { OrderModal } from "./OrderModal";

export type Side = "bid" | "ask";
export type TimeInForce = "GTC" | "IOC" | "FOK";

export interface OrderTicket {
  side: Side;
  type: "limit" | "market";
  /** Defaults to GTC for limit orders and IOC for market orders. */
  timeInForce?: TimeInForce;
  /** Limit price as typed, e.g. "4.85". Ignored for market orders. */
  price?: string;
  /** Contracts. Futures take whole numbers; perps up to 6 decimals. */
  quantity: number;
}

/** The order ticket in the right panel (PlaceOrderWidget), for either venue. */
export class PlaceOrderWidget {
  readonly root: Locator;
  readonly price: Locator;
  readonly quantity: Locator;
  /** "Required Margin" in the summary under the buttons; reads "—" until the margin reads land. */
  readonly requiredMargin: Locator;
  private readonly amountUnit: Locator;
  private readonly tifSelect: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByTestId(TESTIDS.placeOrderWidget);
    this.price = this.root.getByLabel("Price (USDC)", { exact: true });
    this.quantity = this.root.getByLabel("Quantity", { exact: true });
    this.requiredMargin = this.root.getByText("Required Margin", { exact: true }).locator("xpath=..");
    this.amountUnit = this.root.locator("select").filter({ has: page.locator('option[value="quantity"]') });
    // Perps fold time in force into a dropdown; futures show GTC/IOC/FOK buttons.
    this.tifSelect = this.root.locator("select").filter({ has: page.locator("option", { hasText: "IOC" }) });
  }

  button(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }

  async fill(ticket: OrderTicket): Promise<void> {
    await this.button(ticket.type === "limit" ? "Limit" : "Market").click();
    const tif = ticket.timeInForce ?? (ticket.type === "limit" ? "GTC" : "IOC");
    if ((await this.tifSelect.count()) > 0) await this.tifSelect.selectOption({ label: tif });
    else await this.button(tif).click();
    if (ticket.type === "limit") {
      if (!ticket.price) throw new Error("A limit order needs a price");
      await typeInto(this.price, ticket.price);
    }
    await this.amountUnit.selectOption("quantity");
    await typeInto(this.quantity, String(ticket.quantity));
  }

  /** Waits until the ticket can quote margin, i.e. the reads Bid/Ask validate against have landed. */
  async waitUntilQuoted(): Promise<void> {
    await expect(this.requiredMargin).toContainText(/\d+\.\d{2} USDC/, { timeout: 60_000 });
  }

  /** Presses Bid or Ask. The ticket's checks answer with the review modal or an alert. */
  async press(side: Side): Promise<void> {
    await this.button(side === "bid" ? "Bid" : "Ask").click();
  }

  /** The price the ticket pre-fills from the market once the mark has loaded. */
  async marketPrice(): Promise<string> {
    await expect(this.price).toHaveValue(/^\d+(\.\d+)?$/, { timeout: 60_000 });
    return this.price.inputValue();
  }

  /**
   * Fills the ticket and presses Bid/Ask. Throws with the alert's text if the
   * ticket refuses the order, and says so if it cut the size to what the
   * account can margin (its first click does that instead of alerting).
   */
  async submit(ticket: OrderTicket): Promise<OrderModal> {
    await this.fill(ticket);
    await this.waitUntilQuoted();
    const typed = await this.quantity.inputValue();
    await this.press(ticket.side);

    const review = new OrderModal(this.page, ticket.side === "bid" ? "Place Bid Order" : "Place Ask Order");
    const alert = new AlertDialog(this.page);
    // Asserted rather than annotated: TypeScript would otherwise pin it to "waiting", not seeing the poll assign it.
    let state = "waiting" as PressOutcome;
    await expect
      .poll(
        async () => {
          state = await this.pressOutcome(review, alert, typed);
          return state;
        },
        { message: `pressing ${ticket.side} opened neither the review nor an alert` },
      )
      .not.toBe("waiting");
    if (state === "alert") {
      const message = await alert.message.innerText();
      await alert.accept();
      throw new Error(`The ticket refused the ${ticket.side}: ${message}`);
    }
    if (state === "clamped") {
      throw new Error(
        `The ticket cut the ${ticket.side} from ${typed} to ${await this.quantity.inputValue()}: ` +
          "the account cannot margin E2E_ORDER_QTY (raise E2E_MIN_COLLATERAL).",
      );
    }
    return review;
  }

  private async pressOutcome(review: OrderModal, alert: AlertDialog, typed: string): Promise<PressOutcome> {
    if (await review.root.isVisible()) return "review";
    if (await alert.root.isVisible()) return "alert";
    return (await this.quantity.inputValue()) !== typed ? "clamped" : "waiting";
  }
}

/** What pressing Bid/Ask led to: the review modal, an alert, a size cut to the margin cap, or nothing yet. */
type PressOutcome = "review" | "alert" | "clamped" | "waiting";
