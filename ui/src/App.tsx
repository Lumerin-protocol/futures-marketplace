import Box from "@mui/material/Box";
import { ThemeProvider } from "@mui/material/styles";
import type { FC } from "react";
import { darkTheme } from "./styles/themeOptions";
import { tokens } from "./styles/tokens";
import { Router } from "./Router";
import useAnalytics from "./hooks/useAnalytics";

// No Web3Provider here on purpose: wagmi/@reown/appkit stays a lazy chunk
// (see Web3ProviderLazy.ts), mounted only at the specific spots that need
// wallet/contract data (HeaderConnect, the trading sub-header, the page
// bodies) — not around the whole app. That keeps the header/shell able to
// paint immediately without waiting on that bundle at all.
export const App: FC = () => {
  useAnalytics({ loadOn: "idle" });
  return (
    <ThemeProvider theme={darkTheme}>
      <Box sx={{ minHeight: "100vh", bgcolor: tokens.app.bg }}>
        <Router />
      </Box>
    </ThemeProvider>
  );
};
