import { expect } from "@playwright/test";

/**
 * Reads an amount the way the UI prints one: "12.34", "-0.50", "+1.20 USDC",
 * "1,234.56", "−0.07" (U+2212). Returns undefined for placeholders such as
 * "—", "Updating…" or a loading skeleton, so they are never read as zero.
 */
export function tryParseAmount(text: string | null | undefined): number | undefined {
  const normalized = (text ?? "").replace(/\u2212/g, "-").replace(/,/g, "");
  const match = normalized.match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

export function parseAmount(text: string | null | undefined): number {
  const value = tryParseAmount(text);
  if (value === undefined) throw new Error(`Expected an amount, got "${text ?? ""}"`);
  return value;
}

/** Number of decimals in a tick such as 0.01 or 0.0001. */
export function decimalsOf(step: number): number {
  const [, fraction = ""] = String(step).split(".");
  return fraction.length;
}

/** Rounds down onto the tick grid without float drift (2.9999999 → 2.99, not 2.98). */
export function floorToTick(value: number, tick: number): number {
  return Number((Math.floor(value / tick + 1e-9) * tick).toFixed(decimalsOf(tick)));
}

/** The order book's price label (VolumeOrderBook `formatPrice`): 4 decimals under 1 USDC, 2 above. */
export function bookPriceLabel(price: number): string {
  return Math.abs(price) < 1 ? price.toFixed(4) : price.toFixed(2);
}

/** Asserts |actual - expected| <= tolerance with a message that shows all three. */
export function expectClose(actual: number, expected: number, tolerance: number, what: string): void {
  expect(
    Math.abs(actual - expected),
    `${what}: expected ${expected.toFixed(4)} ± ${tolerance}, got ${actual.toFixed(4)}`,
  ).toBeLessThanOrEqual(tolerance + 1e-9);
}

/**
 * Parses a DateTimeCell ("Apr 15, 2026" + "02:30:45 PM"). The browser context
 * runs in UTC (playwright.config.ts), so the text is a UTC wall-clock time.
 */
export function parseUtcDateTime(text: string): Date {
  const date = new Date(`${text.replace(/\s+/g, " ").trim()} UTC`);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a DateTimeCell value: "${text}"`);
  return date;
}
