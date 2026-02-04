import React from 'react';

export type ThemeMode = 'light' | 'dark';

const STYLE_ID = 'alga-ui-kit-theme-bridge';

const themeCss = `
:root {
  --color-background: #ffffff;
  --color-text-900: #111827;
  --color-text-500: #6b7280;
  --color-border-200: #e5e7eb;
  --color-border-100: #f3f4f6;
  --color-primary-500: #7c3aed;
  --color-primary-300: #a78bfa;
  --color-accent-red: #dc2626;
  --color-accent-orange: #d97706;
  --color-accent-green: #16a34a;

  --alga-bg: var(--color-background);
  --alga-fg: var(--color-text-900);
  --alga-muted-fg: var(--color-text-500);
  --alga-border: var(--color-border-200);
  --alga-muted: var(--color-border-100);
  --alga-primary: var(--color-primary-500);
  --alga-primary-foreground: #ffffff;
  --alga-secondary: var(--color-primary-300);
  --alga-secondary-foreground: var(--color-text-900);
  --alga-danger: var(--color-accent-red);
  --alga-warning: var(--color-accent-orange);
  --alga-success: var(--color-accent-green);
  --alga-radius: 6px;
}

:root[data-alga-theme="dark"] {
  --color-background: #0f172a;
  --color-text-900: #f8fafc;
  --color-text-500: #94a3b8;
  --color-border-200: #334155;
  --color-border-100: #1f2937;
  --color-primary-500: #8b5cf6;
  --color-primary-300: #c4b5fd;
  --color-accent-red: #f87171;
  --color-accent-orange: #fbbf24;
  --color-accent-green: #4ade80;
}
`;

export function ThemeBridge({ mode }: { mode: ThemeMode }) {
  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-alga-theme', mode);

    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = themeCss;
      document.head.appendChild(style);
    }
  }, [mode]);

  return null;
}
