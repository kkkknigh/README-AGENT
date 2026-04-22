import type { Config } from "tailwindcss"
import typography from "@tailwindcss/typography"

export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{vue,ts,js}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eef5ff",
          100: "#d9e9ff",
          200: "#bdd8ff",
          300: "#91bcff",
          400: "#6097ff",
          500: "#3f7cff",
          600: "#245fe8",
          700: "#1d4bc4",
          800: "#1e409f",
          900: "#20377d",
          950: "#17234f",
        },
      },
    },
  },
  plugins: [typography],
} satisfies Config
