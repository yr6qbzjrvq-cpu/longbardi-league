/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        espn: {
          DEFAULT: "#0057B8",
          dark: "#00418A",
        },
        nav: {
          DEFAULT: "#101820",
          light: "#22303C",
        },
        link: "#0057B8",
      },
      fontFamily: {
        display: ["var(--font-oswald)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
