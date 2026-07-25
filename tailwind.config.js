/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07090F",
          900: "#0B0E16",
          800: "#131826",
          700: "#1C2336",
          600: "#2A3349",
        },
        turf: {
          400: "#34D399",
          500: "#10B981",
          600: "#059669",
        },
        blaze: {
          400: "#FBBF24",
          500: "#F59E0B",
        },
      },
      fontFamily: {
        display: ["var(--font-oswald)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
