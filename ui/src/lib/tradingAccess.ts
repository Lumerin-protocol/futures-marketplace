/**
 * Jurisdiction signal for the exchange banner.
 *
 * CloudFront stamps `hpdx_allowed`. Only the exact value "1" hides the banner.
 * `0`, a missing cookie, and any other value show it. The UI does not keep a
 * country list — the cookie is the only signal, and it fails closed.
 *
 * Local dev is the one exception: on localhost or 127.0.0.1 a missing cookie
 * hides the banner, so `npm start` works without the WAF. An explicit value
 * other than "1" still shows it there.
 *
 * The banner is a notice only. It does not disable trading.
 */

export const TRADING_ACCESS_COOKIE = "hpdx_allowed";

const listeners = new Set<(allowed: boolean) => void>();

export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function isLocalDevHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function isTradingAllowed(cookieValue: string | null, hostname: string): boolean {
  if (cookieValue === "1") return true;
  if (cookieValue === null && isLocalDevHostname(hostname)) return true;
  return false;
}

export function readTradingAllowed(): boolean {
  if (typeof document === "undefined") return false;
  const hostname = typeof location === "undefined" ? "" : location.hostname;
  return isTradingAllowed(readCookie(document.cookie, TRADING_ACCESS_COOKIE), hostname);
}

export function subscribeTradingAccess(listener: (allowed: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-read the cookie and tell the banner. Returns whether the banner stays hidden. */
export function publishTradingAccess(): boolean {
  const allowed = readTradingAllowed();
  for (const listener of listeners) listener(allowed);
  return allowed;
}
