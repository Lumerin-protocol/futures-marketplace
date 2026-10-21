import { type FC, useEffect } from "react";
import { useLocation } from "react-router";
import { trackPageView } from "../lib/analytics";

// The exchange is one page load. Report the route the trader is actually on,
// so futures and perps stay separate in Analytics.
export const Analytics: FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);
  return null;
};
