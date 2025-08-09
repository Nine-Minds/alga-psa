import { useCallback } from 'react';

export type ThemeMode = 'light' | 'dark';

export function useTheme() {
  const setMode = useCallback((mode: ThemeMode) => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
  }, []);

  const getMode = useCallback<() => ThemeMode>(() => {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }, []);

  return { setMode, getMode };
}

export function applyThemeVars(vars: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
}
