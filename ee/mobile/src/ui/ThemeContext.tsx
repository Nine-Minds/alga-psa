import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { secureStorage } from "../storage/secureStorage";
import { buildTheme, lightTheme, darkTheme, type Theme } from "./themes";
import {
  DEFAULT_MOBILE_THEME_PAIR_ID,
  type MobileTheme,
  type MobileThemePairId,
} from "./themeTokens";

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const THEME_PREF_KEY = "alga.mobile.theme.preference";
export type ThemePreference = "light" | "dark" | "system";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type ThemeContextValue = {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  /** Tenant pair from capabilities (or the device cache); null means built-in Alga. */
  tenantTheme: MobileTheme | null;
  setTenantTheme: (theme: MobileTheme | null) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ThemeProvider({
  children,
  initialTenantTheme = null,
}: {
  children: ReactNode;
  /** Read from the device cache before the first frame, so warm launches are on-brand. */
  initialTenantTheme?: MobileTheme | null;
}) {
  const systemScheme = useColorScheme(); // "light" | "dark" | null
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [tenantTheme, setTenantThemeState] = useState<MobileTheme | null>(initialTenantTheme);

  // Load saved preference on mount
  useEffect(() => {
    let canceled = false;
    const load = async () => {
      const stored = await secureStorage.getItem(THEME_PREF_KEY);
      if (canceled) return;
      if (stored === "light" || stored === "dark" || stored === "system") {
        setPreferenceState(stored);
      }
    };
    void load();
    return () => {
      canceled = true;
    };
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    void secureStorage.setItem(THEME_PREF_KEY, pref);
  }, []);

  const setTenantTheme = useCallback((next: MobileTheme | null) => {
    // Capabilities refreshes hand back a fresh object every time; only a new
    // version is worth a re-render.
    setTenantThemeState((current) => (current?.version === next?.version ? current : next));
  }, []);

  const mode = preference === "system"
    ? (systemScheme === "dark" ? "dark" : "light")
    : preference;

  const theme = useMemo<Theme>(() => {
    if (!tenantTheme) {
      return mode === "dark" ? darkTheme : lightTheme;
    }
    return buildTheme(tenantTheme[mode], mode, {
      pairId: tenantTheme.pairId,
      version: tenantTheme.version,
    });
  }, [tenantTheme, mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, preference, setPreference, tenantTheme, setTenantTheme }),
    [theme, preference, setPreference, tenantTheme, setTenantTheme],
  );

  // Render children even before preference is loaded — use light as default.
  // The brief flash is avoided because useState starts with "system" which
  // resolves via useColorScheme immediately.
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback: outside a provider, return light theme.
    return lightTheme;
  }
  return ctx.theme;
}

export function useColors(): Theme["colors"] {
  return useTheme().colors;
}

export function useThemePreference(): {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
} {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return { preference: "system", setPreference: () => {} };
  }
  return { preference: ctx.preference, setPreference: ctx.setPreference };
}

/** The active pair plus the setter the capabilities bridge pushes updates through. */
export function useTenantTheme(): {
  tenantTheme: MobileTheme | null;
  setTenantTheme: (theme: MobileTheme | null) => void;
  pairId: MobileThemePairId;
  label: string | null;
} {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      tenantTheme: null,
      setTenantTheme: () => {},
      pairId: DEFAULT_MOBILE_THEME_PAIR_ID,
      label: null,
    };
  }
  return {
    tenantTheme: ctx.tenantTheme,
    setTenantTheme: ctx.setTenantTheme,
    pairId: ctx.tenantTheme?.pairId ?? DEFAULT_MOBILE_THEME_PAIR_ID,
    label: ctx.tenantTheme?.label ?? null,
  };
}
