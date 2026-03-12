export { lightTheme, darkTheme } from "./themes";
export { ThemeProvider, useTheme, useColors, useThemePreference } from "./ThemeContext";
export type { Theme } from "./themes";

/**
 * Legacy re-exports for backward compatibility during migration.
 * These pull values from the light theme so that any non-hook imports
 * still compile.  New code should use the useTheme() / useColors() hooks.
 */
import { lightTheme } from "./themes";

export const colors = {
  background: lightTheme.colors.background,
  text: lightTheme.colors.text,
  mutedText: lightTheme.colors.textSecondary,
  danger: lightTheme.colors.danger,
  card: lightTheme.colors.card,
  border: lightTheme.colors.border,
  primary: lightTheme.colors.primary,
  primaryText: lightTheme.colors.textInverse,
} as const;

export const spacing = lightTheme.spacing;

export const typography = {
  title: { fontSize: lightTheme.typography.title.fontSize, fontWeight: lightTheme.typography.title.fontWeight },
  body: { fontSize: lightTheme.typography.body.fontSize, fontWeight: lightTheme.typography.body.fontWeight },
  caption: { fontSize: lightTheme.typography.caption.fontSize, fontWeight: lightTheme.typography.caption.fontWeight },
} as const;
