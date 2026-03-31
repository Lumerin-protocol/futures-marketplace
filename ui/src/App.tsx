import Box from "@mui/material/Box";
import { ThemeProvider } from "@mui/material/styles";
import { darkTheme } from "./styles/themeOptions";
import { tokens } from "./styles/tokens";
import { Router } from "./Router";
import useAnalytics from "./hooks/useAnalytics";
import type { FC } from "react";

export const App: FC = () => {
  useAnalytics({ loadOn: "idle" });
  return (
    // <WagmiProvider config={config}>
    // <QueryClientProvider client={queryClient}>
    <ThemeProvider theme={darkTheme}>
      <Box sx={{ minHeight: "100vh", bgcolor: tokens.app.bg }}>
        <Router />
      </Box>
    </ThemeProvider>
    // </QueryClientProvider>
    // </WagmiProvider>
  );
};
