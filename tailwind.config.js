/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#ffffff",
        panel: "#f6f7f9",
        panel2: "#eef0f4",
        border: "#d9dee6",
        gold: "#b8922a",
        goldSoft: "#c4a35a",
        buy: "#168a54",
        sell: "#c43b36",
        muted: "#5c6573",
        text: "#12151a",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
