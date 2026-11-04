/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // In-between greys the original design used alongside Tailwind's zinc scale.
        zinc: {
          650: "#48484f",
          750: "#333338",
          850: "#1f1f22",
        },
      },
    },
  },
  plugins: [],
};
