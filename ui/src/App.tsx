import type { FC } from "react";
import { styled } from "next-yak";
import { Router } from "./Router";
import { AlertModalHost } from "./components/AlertModal";
import useAnalytics from "./hooks/useAnalytics";
import { Web3Provider } from "./Web3Provider";
import { WalletUiProvider } from "./components/Widgets/ConnectWidget";
import { tokens } from "./styles/tokens";

export const App: FC = () => {
  useAnalytics({ loadOn: "idle" });
  return (
    <Web3Provider>
      <WalletUiProvider>
        <AppRoot>
          <Router />
          <AlertModalHost />
        </AppRoot>
      </WalletUiProvider>
    </Web3Provider>
  );
};

const AppRoot = styled.div`
  min-height: 100vh;
  background-color: ${tokens.app.bg};
`;
