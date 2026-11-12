import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-raised": "rgb(var(--surface-raised) / <alpha-value>)",
        "surface-sunken": "rgb(var(--surface-sunken) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--ink-muted) / <alpha-value>)",
        "ink-faint": "rgb(var(--ink-faint) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        sage: "rgb(var(--sage) / <alpha-value>)",
        "sage-deep": "rgb(var(--sage-deep) / <alpha-value>)",
        "sage-soft": "rgb(var(--sage-soft) / <alpha-value>)",
        blush: "rgb(var(--blush) / <alpha-value>)",
        "accent-deep": "rgb(var(--accent-deep) / <alpha-value>)",
        hero: "rgb(var(--hero) / <alpha-value>)",
        "on-hero": "rgb(var(--on-hero) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      borderRadius: {
        card: "1.375rem",
      },
      boxShadow: {
        card: "0 1px 2px rgb(63 52 32 / 0.05), 0 10px 28px -10px rgb(63 52 32 / 0.12)",
        lift: "0 2px 4px rgb(63 52 32 / 0.06), 0 18px 44px -14px rgb(63 52 32 / 0.20)",
        glow: "0 0 0 1px rgb(var(--accent) / 0.25), 0 10px 32px -8px rgb(var(--accent) / 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
