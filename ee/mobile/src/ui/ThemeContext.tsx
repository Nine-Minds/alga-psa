import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { secureStorage } from "../storage/secureStorage";
import { lightTheme, darkTheme, type Theme } from "./themes";

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const THEME_PREF_KEY = "alga.mobile.theme.preference";
type ThemePreference = "light" | "dark" | "system";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type ThemeContextValue = {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme(); // "light" | "dark" | null
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
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

  const theme = useMemo<Theme>(() => {
    if (preference === "system") {
      return systemScheme === "dark" ? darkTheme : lightTheme;
    }
    return preference === "dark" ? darkTheme : lightTheme;
  }, [preference, systemScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, preference, setPreference }),
    [theme, preference, setPreference],
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
