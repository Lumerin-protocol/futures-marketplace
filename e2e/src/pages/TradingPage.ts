import { expect, type Locator, type Page } from "@playwright/test";
import type { MockWallet } from "../wallet/install";
import { AccountTables } from "./AccountTables";
import { AlertDialog } from "./AlertDialog";
import { BalanceWidget } from "./BalanceWidget";
import { HeaderConnect } from "./HeaderConnect";
import { MarketSelector } from "./MarketSelector";
import { OrderBook } from "./OrderBook";
import type { OrderResult } from "./OrderModal";
import { type OrderTicket, PlaceOrderWidget } from "./PlaceOrderWidget";

export type Venue = "futures" | "perpetual";

/** /trade/futures and /trade/perpetual: one route element, switched by the market selector. */
export class TradingPage {
  readonly header: HeaderConnect;
  readonly market: MarketSelector;
  readonly balance: BalanceWidget;
  readonly book: OrderBook;
  readonly ticket: PlaceOrderWidget;
  readonly tables: AccountTables;
  readonly alert: AlertDialog;
  readonly brand: Locator;

  constructor(
    readonly page: Page,
    readonly wallet: MockWallet,
  ) {
    this.header = new HeaderConnect(page);
    this.market = new MarketSelector(page);
    this.balance = new BalanceWidget(page);
    this.book = new OrderBook(page);
    this.ticket = new PlaceOrderWidget(page);
    this.tables = new AccountTables(page);
    this.alert = new AlertDialog(page);
    this.brand = page.getByText("HashPower Derivatives Exchange", { exact: true });
  }

  /** A label in the trading header's ticker, e.g. "Hash Price", "Contract Size", "Funding Rate (24h)". */
  stat(label: string | RegExp): Locator {
    return this.page.getByText(label, { exact: typeof label === "string" }).first();
  }

  /** The chart's range buttons: "1D", "5D", "1M". */
  chartRange(label: string): Locator {
    return this.page.getByRole("button", { name: label, exact: true });
  }

  async open(venue: Venue = "futures"): Promise<void> {
    await this.page.goto(`/trade/${venue}`);
    await this.waitUntilReady();
  }

  /** Usable once the market list has resolved (the selector names an instrument) and the ticket has its specs. */
  async waitUntilReady(): Promise<void> {
    await expect(this.market.trigger).toBeVisible({ timeout: 60_000 });
    await expect(this.ticket.root).toBeVisible({ timeout: 60_000 });
  }

  /** Connects through AppKit the way a user picks an injected wallet. */
  async connect(): Promise<void> {
    await this.header.connect(this.wallet);
    await expect(this.tables.tab("Open Orders")).toBeVisible();
  }

  async openConnected(venue: Venue = "futures"): Promise<void> {
    await this.open(venue);
    await this.connect();
  }

  /** After a reload wagmi reconnects on its own (the mock wallet remembers the authorization); connect only if it did not. */
  async ensureConnected(): Promise<void> {
    const connected = await expect(this.header.accountButton)
      .not.toHaveText("Connect wallet", { timeout: 10_000 })
      .then(() => true, () => false);
    if (!connected) await this.connect();
    await this.header.expectConnected(this.wallet.address);
  }

  /** Ticket, review, wallet, result screen, closed: returns what the result screen reported. */
  async placeOrder(ticket: OrderTicket): Promise<OrderResult> {
    const review = await this.ticket.submit(ticket);
    const result = await review.place();
    await review.close();
    return result;
  }

  /**
   * Best effort: leaves the account flat on `venue` for the next spec. "Close all" also cancels open
   * orders, so "Cancel all" only runs when there was no position to close.
   */
  async flatten(venue: Venue = "futures"): Promise<void> {
    await this.open(venue);
    await this.ensureConnected();
    if (!(await this.tables.closeAll())) await this.tables.cancelAll();
  }
}
