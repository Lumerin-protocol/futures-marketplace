/**
 * The tradable instruments the venue exposes, and how they are named in the UI.
 *
 * There is one underlying — hash price, quoted in the payment token — but each
 * futures expiration is its own market on-chain: `HashPowerFutures` keys the
 * order book, the net position and the settlement price by `expirationAt`, so
 * picking a date picks an instrument rather than filtering one. Perps live on a
 * separate contract with no expiry dimension.
 *
 * Every label the market selector and the header render comes from here, so the
 * naming is defined once.
 */

/**
 * Underlying. Named rather than tickered because there is no such token: what
 * trades is hash price, and `HPDX` is the venue.
 */
export const BASE_SYMBOL = "Hashprice";
export const QUOTE_SYMBOL = "USDC";
export const PAIR_SYMBOL = `${BASE_SYMBOL}/${QUOTE_SYMBOL}`;

/**
 * `expirationAt` is declared as an absent optional on the perp variant so
 * consumers can destructure it without first narrowing on `mode`.
 */
export type Instrument =
  | { readonly mode: "perpetual"; readonly expirationAt?: undefined }
  | { readonly mode: "futures"; readonly expirationAt: number };

export const PERPETUAL_INSTRUMENT: Instrument = { mode: "perpetual" };

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/** `1760529600` -> `"15 Oct 2026"`. en-GB puts the day first without a comma. */
export function formatExpirationShort(expirationAt: number): string {
  return new Date(expirationAt * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Countdown shown as the secondary line of a selector row: `"36d"`, or `"18h"`
 * inside the last day. An expiry that has already passed reads `"Expired"` —
 * the list is filtered on the same clock, so this is only a brief transient.
 */
export function formatTimeToExpiry(expirationAt: number, now = Date.now()): string {
  const secondsLeft = expirationAt - Math.floor(now / 1000);
  if (secondsLeft <= 0) return "Expired";
  const days = Math.floor(secondsLeft / SECONDS_PER_DAY);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(secondsLeft / SECONDS_PER_HOUR);
  return hours >= 1 ? `${hours}h` : "<1h";
}

/**
 * `"Hashprice/USDC — Perp"` / `"Hashprice/USDC — 15 Oct 2026"`. Singular "Perp"
 * is the ticker convention for a single perpetual instrument (Aevo, Drift,
 * Vertex, Paradex all use `-PERP`); the plural names the product, not a market.
 */
export function formatInstrumentLabel(instrument: Instrument): string {
  return instrument.mode === "perpetual"
    ? `${PAIR_SYMBOL} — Perp`
    : `${PAIR_SYMBOL} — ${formatExpirationShort(instrument.expirationAt)}`;
}

/** Product name for the selector's secondary line. */
export function instrumentKindLabel(instrument: Instrument): string {
  return instrument.mode === "perpetual" ? "Perpetual" : "Futures";
}

const PERPETUAL_KEY = "perpetual";

/**
 * MUI `Select` compares values by identity, so instruments travel through it as
 * strings. This is also the `?expiry=` URL encoding.
 */
export function instrumentKey(instrument: Instrument): string {
  return instrument.mode === "perpetual" ? PERPETUAL_KEY : String(instrument.expirationAt);
}

export function parseInstrumentKey(key: string): Instrument {
  if (key === PERPETUAL_KEY) return PERPETUAL_INSTRUMENT;
  return { mode: "futures", expirationAt: Number(key) };
}
