/**
 * Date formatting is pinned to en-US so labels read the same for every user
 * regardless of browser locale ("Sep 26, 2026, 02:00 PM", never
 * "26 вер. 2026 р., 14:00"). Matches the tables' `DateTimeCell`.
 */
export const DATE_LOCALE = "en-US";

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const MONTH_DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};

/** `1790424000` -> `"Sep 26, 2026, 02:00 PM"`, in the user's time zone. */
export function formatDateTime(unixSeconds: number | bigint | string): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString(DATE_LOCALE, DATE_TIME_OPTIONS);
}

/**
 * `1790424000` -> `"Sep 26"`. For a contract's expiry in a card about that
 * contract: expiries are always ahead and always within months, so the year
 * cannot disambiguate anything, and the time of day is fixed per series — the
 * selector names contracts by day alone, so the card does too.
 */
export function formatMonthDay(unixSeconds: number | bigint | string): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleDateString(DATE_LOCALE, MONTH_DAY_OPTIONS);
}
