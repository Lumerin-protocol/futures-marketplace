import { createTheme } from "@mui/material/styles";
import { tokens } from "./tokens";

export const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
  components: {
    MuiInputBase: {
      styleOverrides: {
        input: {
          "&:-webkit-autofill": {
            WebkitBoxShadow: `0 0 0 100px ${tokens.mui.autofillBg} inset!important`,
            WebkitTextFillColor: "white !important",
            caretColor: "white !important",
            transition: "background-color 9999s ease-out, color 9999s ease-out", // somehow it fixes autocomplete black input text in chrome
          },
        },
      },
    },
  },
});
