// Production Analytics for the exchange. The measurement ID comes from
// config/prd.env. Dev builds leave it empty and send nothing. Page views use
// the route path. Orders name the venue and side, and never include a wallet,
// size, or price.

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

function measurementId(): string {
  return (process.env.REACT_APP_GA_MEASUREMENT_ID ?? "").trim();
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
  window.gtag("event", "page_view", { page_path: path });
}

export function trackOrder(venue: "futures" | "perps", side: "buy" | "sell"): void {
  if (!measurementId() || !window.gtag) return;
  window.gtag("event", "place_order", { venue, side });
}
