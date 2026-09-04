/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0a0d12",
        panel: "#11151c",
        panel2: "#161b24",
        border: "#232935",
        gold: "#d4af5a",
        goldSoft: "#8a7440",
        buy: "#3ecf8e",
        sell: "#e0554f",
        muted: "#7c8698",
        text: "#e6e9ee",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
