import type { ThemePreference } from "../ui/ThemeContext";

type Translate = (key: string, defaultValue: string) => string;

/** System → Light → Dark → System, the order the Appearance row advertises. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

/** Pair name for the read-only Theme row; no theme block means the built-in pair. */
export function describeThemePair(label: string | null, t: Translate): string {
  if (label === null) return t("appearance.themeDefault", "Default");
  if (label === "Custom") return t("appearance.themeCustom", "Custom");
  return label;
}
