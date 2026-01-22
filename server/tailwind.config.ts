import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",

    // Monorepo UI sources consumed by the Next.js app. Keep this list explicit to avoid
    // accidentally scanning `node_modules` and to reduce Tailwind's file-watching workload.
    "../packages/{ui,ui-kit,client-portal,clients,tickets,projects,scheduling,surveys,assets,documents,integrations,billing,auth,workflows,onboarding,tags,jobs,notifications,reference-data,tenancy,users,ee}/src/**/*.{jsx,tsx,mdx}",

    // A small number of `.ts` files contain Tailwind class strings (not JSX). Include them
    // explicitly rather than enabling a broad `**/*.ts` glob.
    "../packages/scheduling/src/components/technician-dispatch/utils.ts",
    "../packages/tickets/src/actions/optimizedTicketActions.ts",
  ],
  theme: {
    extend: {
      gridTemplateColumns: {
        '24': 'repeat(24, minmax(0, 1fr))',
        '96': 'repeat(96, minmax(0, 1fr))',
      },
      textColor: {
        main: {
          base: 'rgb(var(--color-text-base))',
          50: 'rgb(var(--color-text-50))',
          100: 'rgb(var(--color-text-100))',
          200: 'rgb(var(--color-text-200))',
          300: 'rgb(var(--color-text-300))',
          400: 'rgb(var(--color-text-400))',
          500: 'rgb(var(--color-text-500))',
          600: 'rgb(var(--color-text-600))',
          700: 'rgb(var(--color-text-700))',
          800: 'rgb(var(--color-text-800))',
          900: 'rgb(var(--color-text-900))',
        },
      },
      colors: {
        // Base semantic colors for UI components
        border: 'rgb(var(--color-border-200))',
        background: 'white',
        foreground: 'rgb(var(--color-text-900))',
        muted: {
          DEFAULT: 'rgb(var(--color-border-100))',
          foreground: 'rgb(var(--color-text-500))',
        },
        // Status colors
        success: {
          DEFAULT: '#22c55e', // green-500
          foreground: '#ffffff',
        },
        warning: {
          DEFAULT: '#f59e0b', // amber-500
          foreground: '#ffffff',
        },
        error: {
          DEFAULT: '#ef4444', // red-500
          foreground: '#ffffff',
        },
        card: 'white',
        'card-foreground': 'rgb(var(--color-text-900))',
        primary: {
          DEFAULT: 'rgb(var(--color-primary-500) / <alpha-value>)',
          foreground: 'rgb(var(--color-primary-50) / <alpha-value>)',
          50: 'rgb(var(--color-primary-50) / <alpha-value>)',
          100: 'rgb(var(--color-primary-100) / <alpha-value>)',
          200: 'rgb(var(--color-primary-200) / <alpha-value>)',
          300: 'rgb(var(--color-primary-300) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400) / <alpha-value>)',
          500: 'rgb(var(--color-primary-500) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700) / <alpha-value>)',
          800: 'rgb(var(--color-primary-800) / <alpha-value>)',
          900: 'rgb(var(--color-primary-900) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(var(--color-secondary-500) / <alpha-value>)',
          foreground: 'rgb(var(--color-secondary-900) / <alpha-value>)',
          50: 'rgb(var(--color-secondary-50) / <alpha-value>)',
          100: 'rgb(var(--color-secondary-100) / <alpha-value>)',
          200: 'rgb(var(--color-secondary-200) / <alpha-value>)',
          300: 'rgb(var(--color-secondary-300) / <alpha-value>)',
          400: 'rgb(var(--color-secondary-400) / <alpha-value>)',
          500: 'rgb(var(--color-secondary-500) / <alpha-value>)',
          600: 'rgb(var(--color-secondary-600) / <alpha-value>)',
          700: 'rgb(var(--color-secondary-700) / <alpha-value>)',
          800: 'rgb(var(--color-secondary-800) / <alpha-value>)',
          900: 'rgb(var(--color-secondary-900) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent-500) / <alpha-value>)',
          foreground: 'rgb(var(--color-accent-900) / <alpha-value>)',
          50: 'rgb(var(--color-accent-50) / <alpha-value>)',
          100: 'rgb(var(--color-accent-100) / <alpha-value>)',
          200: 'rgb(var(--color-accent-200) / <alpha-value>)',
          300: 'rgb(var(--color-accent-300) / <alpha-value>)',
          400: 'rgb(var(--color-accent-400) / <alpha-value>)',
          500: 'rgb(var(--color-accent-500) / <alpha-value>)',
          600: 'rgb(var(--color-accent-600) / <alpha-value>)',
          700: 'rgb(var(--color-accent-700) / <alpha-value>)',
          800: 'rgb(var(--color-accent-800) / <alpha-value>)',
          900: 'rgb(var(--color-accent-900) / <alpha-value>)',
        },
        sidebar: {
          bg: 'var(--color-sidebar-bg)',
          text: 'var(--color-sidebar-text)',
          hover: 'var(--color-sidebar-hover)',
          icon: 'var(--color-sidebar-icon)',
        },
        header: {
          bg: 'var(--color-header-bg)',
          text: 'var(--color-header-text)',
          border: 'var(--color-header-border)',
          icon: 'var(--color-sidebar-icon)',
        },
        subMenu: {
          bg: 'var(--color-submenu-bg)',
          text: 'var(--color-submenu-text)',
          hover: 'var(--color-submenu-hover)',
          icon: 'var(--color-submenu-icon)',
        },
        // Add destructive colors based on assumed CSS variables
        destructive: 'rgb(var(--color-destructive) / <alpha-value>)',
        'destructive-foreground': 'rgb(var(--color-destructive-foreground) / <alpha-value>)',
      },
      backgroundColor: { // Extend background colors specifically
        destructive: 'rgb(var(--color-destructive) / <alpha-value>)',
      },
      borderColor: {
        main: {
          base: 'rgb(var(--color-border-base))',
          50: 'rgb(var(--color-border-50))',
          100: 'rgb(var(--color-border-100))',
          200: 'rgb(var(--color-border-200))',
          300: 'rgb(var(--color-border-300))',
          400: 'rgb(var(--color-border-400))',
          500: 'rgb(var(--color-border-500))',
          600: 'rgb(var(--color-border-600))',
          700: 'rgb(var(--color-border-700))',
          800: 'rgb(var(--color-border-800))',
          900: 'rgb(var(--color-border-900))',
        },
      },
    },
  },

  plugins: [
    // require('@tailwindcss/forms'),
  ],
};
export default config;
