import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Cinzel", "serif"],
        modern: ['"Space Grotesk"', "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        // Reference the CSS variables defined in index.css so the palette
        // can be swapped (dark/light/custom) without recompiling classes.
        bg: {
          base: "rgb(var(--bg-base) / <alpha-value>)",
          surface: "rgb(var(--bg-surface) / <alpha-value>)",
          elevated: "rgb(var(--bg-elevated) / <alpha-value>)",
        },
        border: {
          subtle: "rgb(var(--border-subtle) / <alpha-value>)",
          strong: "rgb(var(--border-strong) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent-primary) / <alpha-value>)",
          hover: "rgb(var(--accent-primary-hover) / <alpha-value>)",
          secondary: "rgb(var(--accent-secondary) / <alpha-value>)",
        },
        text: {
          primary: "rgb(var(--text-primary) / <alpha-value>)",
          secondary: "rgb(var(--text-secondary) / <alpha-value>)",
          muted: "rgb(var(--text-muted) / <alpha-value>)",
        },
      },
      boxShadow: {
        glow: "0 0 24px -4px rgb(var(--accent-primary) / 0.35)",
      },
      backgroundImage: {
        "purple-radial":
          "radial-gradient(ellipse at top, rgb(var(--accent-secondary) / 0.18), transparent 60%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
