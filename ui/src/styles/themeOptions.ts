import { createTheme } from "@mui/material/styles";
import { tokens } from "./tokens";

export const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: tokens.brand.green,
      dark: tokens.brand.greenDark,
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: tokens.brand.blue,
      dark: tokens.brand.blueDark,
      contrastText: "#FFFFFF",
    },
    error: {
      main: tokens.trading.short,
      dark: tokens.trading.shortHover,
    },
    warning: {
      main: tokens.trading.warning,
    },
    info: {
      main: tokens.brand.blue,
    },
    background: {
      default: tokens.app.bg,
      paper: tokens.surface.card,
    },
    text: {
      primary: tokens.text.primary,
      secondary: tokens.text.secondary,
      disabled: tokens.text.disabled,
    },
    divider: tokens.border.default,
  },
  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiInputBase: {
      styleOverrides: {
        input: {
          "&:-webkit-autofill": {
            WebkitBoxShadow: `0 0 0 100px ${tokens.mui.autofillBg} inset!important`,
            WebkitTextFillColor: `${tokens.text.primary} !important`,
            caretColor: `${tokens.text.primary} !important`,
            transition: "background-color 9999s ease-out, color 9999s ease-out",
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: tokens.surface.inputIsland,
          borderRadius: tokens.radius.sm,
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: tokens.border.default,
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: tokens.brand.blue,
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: tokens.brand.blue,
            borderWidth: "2px",
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.sm,
          fontWeight: 500,
          textTransform: "none" as const,
        },
      },
    },
  },
});
