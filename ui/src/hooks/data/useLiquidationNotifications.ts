import { useEffect, useMemo, useRef, useState } from "react";
import { useUserTrades } from "./perps/useUserTrades";
import { useUserFuturesTrades } from "./useUserFuturesTrades";

/**
 * Polls both products' trade feeds (perps + futures) at 15s for forced
 * `isLiquidation` rows and diffs them against a per-address `localStorage`
 * watermark, so the user gets an in-app toast the first time one of their
 * positions is liquidated — without re-alerting on every refetch or replaying
 * the historical backlog on first load.
 *
 * Not unit-tested (manual verification only, per the liquidation-UI plan).
 */
export type LiquidationNotification = {
  id: string;
  product: "perps" | "futures";
  timestamp: string;
  liquidator: string | null;
};

const storageKey = (address: string) => `liquidation:lastSeen:${address.toLowerCase()}`;

function readSeen(address: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(address));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(address: string, seen: Set<string>): void {
  try {
    localStorage.setItem(storageKey(address), JSON.stringify([...seen]));
  } catch {
    // localStorage unavailable / over quota — degrade silently.
  }
}

export function useLiquidationNotifications(address?: `0x${string}`) {
  const perps = useUserTrades(address, { refetch: true });
  const futures = useUserFuturesTrades(address, { refetch: true });
  const [notifications, setNotifications] = useState<LiquidationNotification[]>([]);
  const initializedFor = useRef<string | null>(null);

  const liquidations = useMemo<LiquidationNotification[]>(() => {
    const perpsLiq = (perps.data ?? [])
      .filter((t) => t.isLiquidation)
      .map((t) => ({
        id: t.id,
        product: "perps" as const,
        timestamp: t.timestamp,
        liquidator: t.liquidator,
      }));
    const futuresLiq = (futures.data ?? [])
      .filter((t) => t.isLiquidation)
      .map((t) => ({
        id: t.id,
        product: "futures" as const,
        timestamp: t.timestamp,
        liquidator: t.liquidator,
      }));
    return [...perpsLiq, ...futuresLiq];
  }, [perps.data, futures.data]);

  useEffect(() => {
    if (!address) {
      setNotifications([]);
      initializedFor.current = null;
      return;
    }

    // Wait for both feeds to settle their first fetch before priming the
    // watermark, otherwise a late-arriving backlog would all read as "new".
    if (perps.loading || futures.loading) return;

    const seen = readSeen(address);

    // First settled observation for this address: prime the watermark with the
    // existing liquidations so we only toast ones that arrive afterwards.
    if (initializedFor.current !== address) {
      initializedFor.current = address;
      const primed = new Set(seen);
      for (const liq of liquidations) primed.add(liq.id);
      writeSeen(address, primed);
      return;
    }

    const fresh = liquidations.filter((liq) => !seen.has(liq.id));
    if (fresh.length === 0) return;

    const next = new Set(seen);
    for (const liq of fresh) next.add(liq.id);
    writeSeen(address, next);
    setNotifications((prev) => [...fresh, ...prev]);
  }, [address, liquidations, perps.loading, futures.loading]);

  const dismiss = (id: string) =>
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  const dismissAll = () => setNotifications([]);

  return { notifications, dismiss, dismissAll };
}
