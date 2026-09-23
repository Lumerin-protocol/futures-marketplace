import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { refreshVenueViews } from "./refreshVenueViews";
import { useUserLiquidations } from "./useUserLiquidations";

/**
 * Polls both products' liquidation feeds (perps + futures) at 15s and diffs them
 * against a per-address `localStorage` watermark, so the user gets an in-app
 * toast the first time one of their positions is liquidated — without
 * re-alerting on every refetch or replaying the historical backlog on first
 * load.
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
  const queryClient = useQueryClient();
  const { futures, perps } = useUserLiquidations(address);
  const [notifications, setNotifications] = useState<LiquidationNotification[]>([]);
  const initializedFor = useRef<string | null>(null);

  const liquidations = useMemo<LiquidationNotification[]>(
    () => [...(perps.data ?? []), ...(futures.data ?? [])],
    [perps.data, futures.data],
  );

  useEffect(() => {
    if (!address) {
      setNotifications([]);
      initializedFor.current = null;
      return;
    }

    // Wait for both feeds to settle their first fetch before priming the
    // watermark, otherwise a late-arriving backlog would all read as "new".
    if (perps.isPending || futures.isPending) return;

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

    // A keeper liquidation is not the user's own transaction, so none of the
    // post-tx invalidation paths fire for it. Refresh the affected venue here so
    // the orders/positions/history views reflect the forced close.
    for (const product of new Set(fresh.map((liq) => liq.product))) {
      refreshVenueViews(queryClient, product === "perps" ? "perpetual" : "futures", address);
    }
  }, [address, liquidations, perps.isPending, futures.isPending, queryClient]);

  const dismiss = (id: string) =>
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  const dismissAll = () => setNotifications([]);

  return { notifications, dismiss, dismissAll };
}
