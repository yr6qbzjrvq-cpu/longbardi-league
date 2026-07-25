/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        espn: {
          DEFAULT: "#CC0000",
          dark: "#A50000",
        },
        nav: {
          DEFAULT: "#1B1C1F",
          light: "#2A2B2F",
        },
        link: "#2566B2",
      },
      fontFamily: {
        display: ["var(--font-oswald)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
