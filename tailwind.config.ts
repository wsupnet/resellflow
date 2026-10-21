import type { Config } from "tailwindcss";

// Theme-able color slots. Every value is an RGB triplet CSS variable (defined
// per-theme in globals.css), so `bg-slate-50/60`-style opacity modifiers keep
// working. Light theme = Tailwind's stock values; cream/dark swap the variables.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (name: string, steps: number[]) =>
  Object.fromEntries(steps.map((s) => [s, v(`${name}-${s}`)]));

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        slate: scale("slate", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        emerald: scale("emerald", [50, 100, 300, 400, 500, 600, 700]),
        red: scale("red", [50, 100, 200, 500, 600, 700]),
        amber: scale("amber", [50, 100, 200, 300, 600, 700, 800]),
        purple: scale("purple", [100, 700]),
        brand: scale("brand", [50, 100, 200, 300, 500, 600, 700])
      }
    }
  },
  plugins: []
};

export default config;
