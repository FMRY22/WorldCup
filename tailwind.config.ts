import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        arabic: ["Cairo", "Noto Sans Arabic", "sans-serif"],
      },
      colors: {
        gold: {
          400: "#f5c542",
          500: "#e8a900",
          600: "#c48a00",
        },
        pitch: {
          dark: "#0a2e0a",
          mid: "#0f3d0f",
          light: "#145214",
        },
      },
    },
  },
  plugins: [],
};

export default config;
