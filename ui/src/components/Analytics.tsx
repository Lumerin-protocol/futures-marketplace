import { type FC, useEffect } from "react";
import { useLocation } from "react-router";
import { trackPageView } from "../lib/analytics";

// The exchange is one page load. Report the route path the trader is on.
export const Analytics: FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);
  return null;
};
