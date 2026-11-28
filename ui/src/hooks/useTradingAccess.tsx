import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { publishTradingAccess, readTradingAllowed, subscribeTradingAccess } from "../lib/tradingAccess";

const TradingAccessContext = createContext<boolean | null>(null);

/**
 * Reads `hpdx_allowed` on mount and again whenever the tab becomes visible,
 * so the banner updates without a full reload.
 */
export function TradingAccessProvider({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(() => readTradingAllowed());

  useEffect(() => {
    setAllowed(readTradingAllowed());
    const unsubscribe = subscribeTradingAccess(setAllowed);
    const onVisibility = () => {
      if (document.visibilityState === "visible") publishTradingAccess();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <TradingAccessContext.Provider value={allowed}>{children}</TradingAccessContext.Provider>;
}

export function useTradingAllowed(): boolean {
  const allowed = useContext(TradingAccessContext);
  return allowed ?? readTradingAllowed();
}
