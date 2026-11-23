import { expect, type Locator, type Page } from "@playwright/test";
import { TESTIDS } from "../testids";
import { parseUtcDateTime, tryParseAmount } from "../utils/numbers";
import { ClosePositionModal } from "./ClosePositionModal";
import { ModifyOrderModal } from "./ModifyOrderModal";
import type { OrderResult } from "./OrderModal";
import { TransactionModal } from "./TransactionModal";

export type AccountTab = "Open Orders" | "Positions" | "Trades" | "Position History" | "Order History";
export type Direction = "Long" | "Short";

/** The subgraph-backed tables only change once the indexer has caught up, so row expectations wait this long. */
export const INDEXER_TIMEOUT = 90_000;

/** An open position as Positions shows it; rows are grouped per entry price. */
export interface PositionRow {
  side: Direction;
  status: string;
  entryPrice: number;
  quantity: number;
  unrealizedPnl: number | undefined;
}

/** A closed position as Position History shows it. */
export interface HistoryRow {
  side: Direction;
  maxQuantity: number;
  entryPrice: number;
  exitPrice: number | undefined;
  realizedPnl: number | undefined;
  closedAt: Date | undefined;
}

/**
 * The tabbed tables under the chart (OrdersPositionsTabWidget / its perps twin).
 * Only rendered once a wallet is connected.
 */
export class AccountTables {
  readonly orders: Locator;
  readonly positions: Locator;
  readonly positionHistory: Locator;

  constructor(private readonly page: Page) {
    this.orders = page.getByTestId(TESTIDS.ordersList);
    this.positions = page.getByTestId(TESTIDS.positionsList);
    this.positionHistory = page.getByTestId(TESTIDS.positionHistoryList);
  }

  /** Tab buttons read "<name> <count>". */
  tab(name: AccountTab): Locator {
    return this.page.getByRole("button", { name: new RegExp(`^${name} \\d+$`) });
  }

  /** Switches tab and waits for its table to finish loading ("Loading orders..." and the like). */
  async open(name: AccountTab): Promise<void> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveClass(/\bactive\b/);
    const table =
      name === "Open Orders"
        ? this.orders
        : name === "Positions"
          ? this.positions
          : name === "Position History"
            ? this.positionHistory
            : undefined;
    if (table) {
      await expect(table).toBeVisible();
      await expect(table.getByText(/^Loading .*\.\.\.$/)).toHaveCount(0, { timeout: 60_000 });
    }
  }

  /** Open-order rows, optionally narrowed to a side and a price as the table prints it ("4.85"). */
  orderRows(filter: { side?: Direction; price?: string } = {}): Locator {
    return this.dataRows(this.orders, filter.side, filter.price);
  }

  positionRows(filter: { side?: Direction; price?: string } = {}): Locator {
    return this.dataRows(this.positions, filter.side, filter.price);
  }

  historyRows(): Locator {
    return this.dataRows(this.positionHistory);
  }

  async cancelOrder(row: Locator): Promise<void> {
    await row.getByRole("button", { name: "Cancel", exact: true }).click();
    const modal = new TransactionModal(this.page, "Cancel Order");
    // The futures form names its button after the action; the perps one keeps the default "Execute".
    await modal.button("Cancel Order").or(modal.button("Execute")).click();
    await modal.waitForSuccess();
    await modal.close();
  }

  /** A futures Open Orders row's Contract Expiration, in unix seconds. */
  async orderExpiration(row: Locator): Promise<number> {
    const [expiration] = await cellTexts(row);
    return parseUtcDateTime(expiration).getTime() / 1000;
  }

  /** Moves the order in `row` to a new price (and optionally size) through its Modify modal. */
  async modifyOrder(row: Locator, change: { price: string; quantity?: number }): Promise<void> {
    await row.getByRole("button", { name: "Modify", exact: true }).click();
    const modal = new ModifyOrderModal(this.page);
    await modal.expectOpen();
    await modal.submit(change);
    await modal.close();
  }

  /** Closes the position in `row` with one closing order; returns what the result screen reported. */
  async closePosition(row: Locator, order: { type: "market" } | { type: "limit"; price: string }): Promise<OrderResult> {
    await row.getByRole("button", { name: "Close", exact: true }).click();
    const review = await new ClosePositionModal(this.page).review(order);
    const result = await review.place();
    await review.close();
    return result;
  }

  /** Every Positions row, read cell by cell (columns as in PositionsListWidget). */
  async readPositions(): Promise<PositionRow[]> {
    const rows = await this.positionRows().all();
    return Promise.all(
      rows.map(async (row) => {
        const [, side, status, price, quantity, , pnl] = await cellTexts(row);
        return {
          side: side as Direction,
          status,
          entryPrice: Number(price),
          quantity: Number(quantity),
          unrealizedPnl: tryParseAmount(pnl),
        };
      }),
    );
  }

  /** Reads one Position History row (columns as in HistoricalPositionsListWidget). */
  async readHistoryRow(row: Locator): Promise<HistoryRow> {
    const [, side, , price, maxQuantity, exitPrice, realizedPnl, , closed] = await cellTexts(row);
    return {
      side: side as Direction,
      maxQuantity: Number(maxQuantity),
      entryPrice: Number(price),
      exitPrice: tryParseAmount(exitPrice),
      realizedPnl: tryParseAmount(realizedPnl),
      closedAt: closed && closed !== "-" ? parseUtcDateTime(closed) : undefined,
    };
  }

  /** Waits for a Position History row that `matches`, e.g. the session a spec just closed. */
  async findHistory(matches: (row: HistoryRow) => boolean, what: string): Promise<HistoryRow> {
    let found: HistoryRow | undefined;
    await expect
      .poll(
        async () => {
          for (const row of await this.historyRows().all()) {
            const read = await this.readHistoryRow(row);
            if (matches(read)) {
              found = read;
              return read;
            }
          }
          return undefined;
        },
        { message: `Position History never showed ${what}`, timeout: INDEXER_TIMEOUT },
      )
      .not.toBeUndefined();
    return found as HistoryRow;
  }

  /** "Cancel all" on Open Orders. Returns false when there was nothing to cancel. */
  async cancelAll(): Promise<boolean> {
    await this.open("Open Orders");
    const button = this.page.getByRole("button", { name: "Cancel all", exact: true });
    if (!(await button.isVisible())) return false;
    await button.click();
    const modal = new TransactionModal(this.page, "Cancel All Orders");
    await modal.execute("Cancel All");
    await modal.close();
    return true;
  }

  /** "Close all" on Positions: closes every position at market and cancels open orders. False when flat. */
  async closeAll(): Promise<boolean> {
    await this.open("Positions");
    const button = this.page.getByRole("button", { name: "Close all", exact: true });
    if (!(await button.isVisible())) return false;
    await expect(button).toBeEnabled();
    await button.click();
    const modal = new TransactionModal(this.page, "Close All Positions");
    await modal.execute("Close All");
    await modal.close();
    return true;
  }

  private dataRows(table: Locator, side?: Direction, price?: string): Locator {
    // Data rows have cells; the header row has column headers only.
    let rows = table.getByRole("row").filter({ has: this.page.getByRole("cell") });
    if (side) rows = rows.filter({ has: this.page.getByText(side, { exact: true }) });
    if (price) rows = rows.filter({ has: this.page.getByRole("cell", { name: price, exact: true }) });
    return rows;
  }
}

async function cellTexts(row: Locator): Promise<string[]> {
  return (await row.getByRole("cell").allInnerTexts()).map((text) => text.trim());
}
