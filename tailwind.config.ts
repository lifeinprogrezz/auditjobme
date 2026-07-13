import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // Same stack the /roles map uses (roles.css --font-d / --font-s / --font-m);
        // @fontsource imports live in src/main.tsx so every page gets them.
        display: ['"Space Grotesk"', '"Geist Sans"', "system-ui", "sans-serif"],
        sans: ['"Geist Sans"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      // The §2.1 type scale as first-class tokens (design direction 2026-07-12) — the
      // ONLY sizes the page world may use, so a diff never needs an arbitrary
      // `text-[…]`. Line-height/tracking/weight are baked per the token spec; the
      // Tailwind defaults (text-xs=12 dense · text-sm=14 body · text-base=16 title ·
      // text-lg=18 section · text-2xl=24 page) stay available since `extend` merges.
      fontSize: {
        micro: ["10px", { lineHeight: "1.3", letterSpacing: "0.08em", fontWeight: "600" }],
        caption: ["11px", { lineHeight: "1.4", letterSpacing: "0.01em" }],
        dense: ["12px", { lineHeight: "1.5" }],
        control: ["13px", { lineHeight: "1.4" }],
        body: ["14px", { lineHeight: "1.6" }],
        title: ["16px", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
        section: ["18px", { lineHeight: "1.25", letterSpacing: "-0.02em", fontWeight: "600" }],
        page: ["24px", { lineHeight: "1.15", letterSpacing: "-0.025em", fontWeight: "600" }],
        display: ["32px", { lineHeight: "1.1", letterSpacing: "-0.04em", fontWeight: "600" }],
      },
      boxShadow: {
        // D-class paper elevations (design direction §2.5): two-layer ink-tinted
        // shadows whose paint stays dark in both themes (src/index.css tokens).
        page: "var(--shadow-page)",
        "page-lift": "var(--shadow-page-lift)",
      },
      colors: {
        score: {
          great: "hsl(var(--score-great))",
          "great-deep": "hsl(var(--score-great-deep))",
          "great-ink": "hsl(var(--score-great-ink))",
          mid: "hsl(var(--score-mid))",
          low: "hsl(var(--score-low))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
