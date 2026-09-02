/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "cs-bg":      "#0d1117",
        "cs-surface": "#161b22",
        "cs-border":  "#30363d",
        "cs-accent":  "#2563eb",
        "cs-green":   "#22c55e",
        "cs-yellow":  "#eab308",
        "cs-red":     "#ef4444",
        "cs-text":    "#e6edf3",
        "cs-muted":   "#8b949e",
      },
      animation: {
        "pulse-dot":  "pulseDot 1.5s ease-in-out infinite",
        "slide-in":   "slideIn 0.3s ease-out",
        "fade-in":    "fadeIn 0.4s ease-out",
        "spin-slow":  "spin 3s linear infinite",
      },
      keyframes: {
        pulseDot: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.4 } },
        slideIn:  { from: { transform: "translateX(100%)", opacity: 0 }, to: { transform: "translateX(0)", opacity: 1 } },
        fadeIn:   { from: { opacity: 0, transform: "translateY(8px)" }, to: { opacity: 1, transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
