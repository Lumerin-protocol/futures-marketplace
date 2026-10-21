// Production Analytics for the exchange. The measurement ID is public, but
// the production deploy is the only build that sets it. Dev builds leave it
// empty and send nothing. Events name the venue (futures or perps) and never
// include a wallet, size, or price.

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const MEASUREMENT_ID = /^G-[A-Z0-9]+$/;

function measurementId(): string {
  const id = (process.env.REACT_APP_GA_MEASUREMENT_ID ?? "").trim();
  return MEASUREMENT_ID.test(id) ? id : "";
}

let started = false;

export function startAnalytics(): void {
  const id = measurementId();
  if (!id || started || typeof document === "undefined") return;
  started = true;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", id, { send_page_view: false });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);
}

export function trackPageView(path: string): void {
  if (!measurementId() || !window.gtag) return;
  const screen =
    path.startsWith("/trade/perpetual")
      ? { title: "Perpetuals", venue: "perps" }
      : path.startsWith("/trade/futures")
        ? { title: "Futures", venue: "futures" }
        : path.startsWith("/leaderboard")
          ? { title: "Leaderboard", venue: "leaderboard" }
          : null;
  if (!screen) return;
  window.gtag("event", "page_view", {
    page_path: path,
    page_title: screen.title,
    venue: screen.venue,
  });
}

export function trackOrder(venue: "futures" | "perps", side: "buy" | "sell"): void {
  if (!measurementId() || !window.gtag) return;
  window.gtag("event", "place_order", { venue, side });
}
