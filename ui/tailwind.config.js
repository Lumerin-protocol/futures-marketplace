const { colors } = require("./src/styles/styles.config");

export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./index.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "Roboto", "sans-serif"],
        mono: ["'JetBrains Mono'", "'SF Mono'", "'Fira Code'", "monospace"],
        Inter: ["Inter", "sans-serif"],
        Montserrat: ["Montserrat", "sans-serif"],
        Raleway: ["Raleway", "sans-serif"],
      },
      fontSize: {
        caption: ["0.625rem", { lineHeight: "0.875rem" }],
        small: ["0.75rem", { lineHeight: "1rem" }],
        body: ["0.875rem", { lineHeight: "1.25rem" }],
        h3: ["1rem", { lineHeight: "1.5rem" }],
        h2: ["1.25rem", { lineHeight: "1.75rem" }],
        h1: ["1.5rem", { lineHeight: "2rem" }],
        display: ["1.875rem", { lineHeight: "2.25rem" }],
        xxs: ".625rem",
        xs: ".8125rem",
        sm: "1rem",
        md: "1.25rem",
        lg: "1.75rem",
        xl: "2rem",
        xxl: "2.5rem",
        18: "1.125rem",
        50: "3.125rem",
      },
      colors,
      spacing: {
        50: "12.5rem",
        10: "3.25rem",
      },
      minWidth: {
        21: "21rem",
        26: "26rem",
        28: "28rem",
      },
      maxWidth: {
        32: "32rem",
        "3/4": "75%",
      },
      borderRadius: {
        none: "0px",
        sm: "4px",
        DEFAULT: "8px",
        md: "8px",
        lg: "12px",
        full: "9999px",
        5: "5px",
        10: "10px",
        15: "15px",
        20: "20px",
        30: "30px",
        50: "50px",
        120: "120px",
        "50%": "50%",
      },
      boxShadow: {
        "hpdx-1": "0 1px 3px rgba(0,0,0,0.08)",
        "hpdx-2": "0 4px 12px rgba(0,0,0,0.12)",
        "hpdx-3": "0 8px 24px rgba(0,0,0,0.16)",
        "hpdx-4": "0 16px 48px rgba(0,0,0,0.20)",
      },
      padding: {
        18: "4.5rem",
      },
      height: {
        100: "10px",
        320: "32px",
        400: "40px",
        500: "50px",
        600: "60px",
        750: "75px",
      },
      width: {
        95: "95%",
        99: "99%",
      },
      screens: {
        md: "900px",
      },
    },
  },
  variants: {
    extend: {},
  },
};
