import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#07090d",
        panel: "#11151c",
        panel2: "#171d27",
        border: "rgba(255,255,255,0.07)",
        gold: "#d4af5a",
        goldSoft: "#8a7440",
        goldDim: "rgba(212,175,90,0.14)",
        buy: "#3ecf8e",
        sell: "#e0554f",
        muted: "#8b93a3",
        text: "#e8ebf0",
        ink: "#07090d",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      fontSize: {
        kicker: ["10px", { lineHeight: "1.2", letterSpacing: "0.12em" }],
        micro: ["11px", { lineHeight: "1.45" }],
      },
      borderRadius: {
        desk: "1rem",
        tile: "0.75rem",
      },
      boxShadow: {
        desk: "0 12px 40px rgba(0,0,0,0.38)",
        glow: "0 0 24px rgba(212,175,90,0.22)",
      },
      letterSpacing: {
        kicker: "0.12em",
      },
    },
  },
  plugins: [],
};
export default config;
