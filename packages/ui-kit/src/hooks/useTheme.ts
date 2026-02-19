import { useCallback, useEffect, useState } from 'react';

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

  // Reactive resolved mode -- updates when the theme changes via the bridge
  // or a manual toggle.
  const [resolvedMode, setResolvedMode] = useState<ThemeMode>(getMode);

  useEffect(() => {
    // Sync from the custom event dispatched by the theme bridge / toggle
    const onThemeChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mode === 'dark' || detail?.mode === 'light') {
        setResolvedMode(detail.mode);
      }
    };
    window.addEventListener('alga-theme-change', onThemeChange);

    // Also watch the attribute directly as a fallback
    const observer = new MutationObserver(() => {
      setResolvedMode(getMode());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      window.removeEventListener('alga-theme-change', onThemeChange);
      observer.disconnect();
    };
  }, [getMode]);

  return { setMode, getMode, resolvedMode };
}

export function applyThemeVars(vars: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
}
