import { expect, type Locator, type Page } from "@playwright/test";
import { parseUtcDateTime } from "../utils/numbers";

const INSTRUMENT_LABEL = /Hashprice\/USDC — (?:Perp|\d{1,2} [A-Z][a-z]{2} \d{4})/;
const EXPIRATION_DAY = /\d{1,2} [A-Z][a-z]{2} \d{4}/;

/**
 * The instrument picker at the left of the trading header (MarketSelector):
 * "Hashprice/USDC — Perp", then one row per futures expiration
 * ("Hashprice/USDC — 15 Oct 2026"). It replaced the Futures/Perpetuals tabs.
 */
export class MarketSelector {
  readonly trigger: Locator;
  readonly listbox: Locator;

  constructor(private readonly page: Page) {
    this.trigger = page.getByRole("button", { name: /^Hashprice\/USDC —/ });
    this.listbox = page.getByRole("listbox");
  }

  perpetualOption(): Locator {
    return this.listbox.getByRole("option", { name: /— Perp\b/ });
  }

  futuresOptions(): Locator {
    return this.listbox.getByRole("option", { name: /— \d{1,2} [A-Z][a-z]{2} \d{4}/ });
  }

  async open(): Promise<void> {
    await expect(() => this.openOnce()).toPass({ timeout: 30_000 });
  }

  /** How many perp and futures rows the menu lists, read while it is (still) open. */
  async listed(): Promise<{ perpetual: number; futures: number }> {
    let counts = { perpetual: 0, futures: 0 };
    await expect(async () => {
      await this.openOnce();
      counts = { perpetual: await this.perpetualOption().count(), futures: await this.futuresOptions().count() };
      await expect(this.trigger).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    return counts;
  }

  /** The futures expirations the menu lists, as the UTC days their labels name, in menu order. */
  async listedExpirations(): Promise<Date[]> {
    let labels: string[] = [];
    await expect(async () => {
      await this.openOnce();
      labels = await this.futuresOptions().allTextContents();
      await expect(this.trigger).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    return labels.map((label) => parseUtcDateTime(label.match(EXPIRATION_DAY)?.[0] ?? label));
  }

  async choosePerpetual(): Promise<void> {
    await this.pick(() => this.perpetualOption(), /\/trade\/perpetual/);
  }

  /** Picks the `index`-th futures expiration (0 = the front month). */
  async chooseFutures(index = 0): Promise<void> {
    await this.pick(() => this.futuresOptions().nth(index), /\/trade\/futures\?expiry=\d+/);
  }

  /** Picks the earliest expiration listed and returns it in unix seconds, as `?expiry=` names it. */
  async chooseNearestFutures(): Promise<number> {
    const days = (await this.listedExpirations()).map((day) => day.getTime());
    expect(days.length, "futures expirations listed").toBeGreaterThan(0);
    const nearest = days.indexOf(Math.min(...days));
    await this.chooseFutures(nearest);
    const expiry = Number(new URL(this.page.url()).searchParams.get("expiry"));
    expect(new Date(expiry * 1000).toISOString().slice(0, 10), "?expiry= names the picked day").toBe(
      new Date(days[nearest]).toISOString().slice(0, 10),
    );
    return expiry;
  }

  /**
   * The menu closes on any scroll in the page, and the futures order book
   * re-centres itself whenever its levels change (first when they load), so a
   * pick can lose the menu mid-click. Open-and-pick is retried as a whole until
   * the route switched.
   */
  private async pick(option: () => Locator, route: RegExp): Promise<void> {
    let label = "";
    await expect(async () => {
      await this.openOnce();
      const target = option();
      label = (await target.textContent({ timeout: 5_000 }))?.match(INSTRUMENT_LABEL)?.[0] ?? "";
      expect(label, "option label").not.toBe("");
      await target.click({ timeout: 5_000 });
      await expect(this.page).toHaveURL(route, { timeout: 5_000 });
      await expect(this.trigger).toContainText(label, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
  }

  /** One short attempt, so the retry loops around it get to click again when the menu closed by itself. */
  private async openOnce(): Promise<void> {
    if ((await this.trigger.getAttribute("aria-expanded")) !== "true") await this.trigger.click({ timeout: 5_000 });
    // The menu stays mounted through its exit transition, so visibility alone can be a closing menu.
    await expect(this.trigger).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
    await expect(this.listbox).toBeVisible({ timeout: 2_000 });
  }
}
