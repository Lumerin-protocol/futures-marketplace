import { expect, type Locator, type Page } from "@playwright/test";
import { TESTIDS } from "../testids";
import { bookPriceLabel } from "../utils/numbers";

export interface BookTop {
  bestBid: number;
  bestAsk: number;
}

/**
 * The order book (VolumeOrderBook for futures, PerpsVolumeOrderBook for perps).
 * Rows carry data-side / data-price / data-quantity; the spread row carries
 * the best bid and ask. The futures ladder is virtualized, so a price level
 * only exists in the DOM while it is scrolled into view.
 */
export class OrderBook {
  readonly center: Locator;
  readonly rows: Locator;

  constructor(private readonly page: Page) {
    this.center = page.getByTestId(TESTIDS.orderBookCenter);
    this.rows = page.getByTestId(TESTIDS.orderBookRow);
  }

  /** Waits for bids and asks on both sides of the spread — on dev, a sign the market maker is quoting. */
  async waitForTwoSidedBook(timeout = 60_000): Promise<BookTop> {
    await this.recenter();
    await expect(this.center).toHaveAttribute("data-best-bid", /\d/, { timeout });
    await expect(this.center).toHaveAttribute("data-best-ask", /\d/, { timeout });
    return this.top();
  }

  async top(): Promise<BookTop> {
    await this.recenter();
    const [bid, ask] = await Promise.all([
      this.center.getAttribute("data-best-bid"),
      this.center.getAttribute("data-best-ask"),
    ]);
    if (!bid || !ask) throw new Error(`The order book is one-sided (best bid ${bid ?? "none"}, best ask ${ask ?? "none"})`);
    return { bestBid: Number(bid), bestAsk: Number(ask) };
  }

  /** Resting quantity at `price`: 0 for an empty level or one that is not on the ladder. */
  async quantityAt(price: number): Promise<number> {
    const label = bookPriceLabel(price);
    if (!(await this.scrollTo(label))) return 0;
    const value = await this.rows.and(this.page.locator(`[data-price="${label}"]`)).first().getAttribute("data-quantity");
    return Number(value ?? 0);
  }

  /** The futures ladder stops re-centering once scrolled; its "Scroll to Spread" button brings the spread back. */
  private async recenter(): Promise<void> {
    const back = this.page.getByRole("button", { name: /Scroll to Spread/ });
    if (await back.isVisible()) await back.click();
    await expect(this.center).toBeVisible();
  }

  /** Scrolls the book until the row for `label` is rendered. False when the ladder has no such level. */
  private scrollTo(label: string): Promise<boolean> {
    return this.page.evaluate(
      async ({ selector, label }) => {
        const find = () => document.querySelector<HTMLElement>(`${selector}[data-price="${label}"]`);
        const first = document.querySelector(selector);
        let scroller = first?.parentElement ?? null;
        while (
          scroller &&
          !(scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
        ) {
          scroller = scroller.parentElement;
        }
        const target = Number(label);
        const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        for (let step = 0; step < 400; step++) {
          const hit = find();
          if (hit) {
            hit.scrollIntoView({ block: "center" });
            return true;
          }
          if (!scroller) return false;
          // Ladders run from the highest price at the top to the lowest at the bottom.
          const prices = [...document.querySelectorAll(selector)].map((row) => Number(row.getAttribute("data-price")));
          const highest = Math.max(...prices);
          const lowest = Math.min(...prices);
          if (target < highest && target > lowest) return false;
          const before = scroller.scrollTop;
          scroller.scrollTop += (target > highest ? -0.8 : 0.8) * scroller.clientHeight;
          if (scroller.scrollTop === before) return false;
          await settle();
        }
        return false;
      },
      { selector: `[data-testid="${TESTIDS.orderBookRow}"]`, label },
    );
  }
}
