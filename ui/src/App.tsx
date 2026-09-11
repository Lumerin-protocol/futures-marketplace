import type { FC } from "react";
import styled from "@emotion/styled";
import { Router } from "./Router";
import { AlertModalHost } from "./components/AlertModal";
import useAnalytics from "./hooks/useAnalytics";
import { tokens } from "./styles/tokens";

// No Web3Provider here on purpose: wagmi/@reown/appkit stays a lazy chunk
// (see Web3ProviderLazy.ts), mounted only at the specific spots that need
// wallet/contract data (HeaderConnect, the trading sub-header, the page
// bodies) — not around the whole app. That keeps the header/shell able to
// paint immediately without waiting on that bundle at all.
export const App: FC = () => {
  useAnalytics({ loadOn: "idle" });
  return (
    <AppRoot>
      <Router />
      <AlertModalHost />
    </AppRoot>
  );
};

const AppRoot = styled("div")`
  min-height: 100vh;
  background-color: ${tokens.app.bg};
`;
