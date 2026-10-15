/**
 * The tenant theme block as it arrives from /api/v1/mobile/me/capabilities and
 * as it is cached on the device: 15 seed tokens per mode plus the pair's
 * identity. Everything here is untrusted input — a stale cache or an older
 * server — so the guard is total and never throws.
 */

import { hexToRgb } from "./themeMath";

export const MOBILE_THEME_TOKEN_KEYS = [
  "background",
  "card",
  "surface",
  "textPrimary",
  "textSecondary",
  "textMuted",
  "border",
  "borderStrong",
  "primary",
  "secondary",
  "accent",
  "sidebarBg",
  "sidebarText",
  "sidebarHover",
  "headerBg",
] as const;

export type MobileThemeTokenKey = (typeof MOBILE_THEME_TOKEN_KEYS)[number];
export type MobileThemeSeedTokens = Record<MobileThemeTokenKey, string>;

/** Ids the web offers; an unknown id means the app and server disagree. */
export const MOBILE_THEME_PAIR_IDS = [
  "alga",
  "slate",
  "ocean",
  "sky",
  "forest",
  "sunset",
  "cappuccino",
  "vice",
  "high-contrast",
  "custom",
] as const;

export type MobileThemePairId = (typeof MOBILE_THEME_PAIR_IDS)[number];

export const DEFAULT_MOBILE_THEME_PAIR_ID: MobileThemePairId = "alga";
export const HIGH_CONTRAST_PAIR_ID: MobileThemePairId = "high-contrast";

export type MobileTheme = {
  pairId: MobileThemePairId;
  label: string;
  light: MobileThemeSeedTokens;
  dark: MobileThemeSeedTokens;
  version: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isMobileThemePairId(value: unknown): value is MobileThemePairId {
  return typeof value === "string" && (MOBILE_THEME_PAIR_IDS as readonly string[]).includes(value);
}

function parseSeedTokens(value: unknown): MobileThemeSeedTokens | null {
  if (!isRecord(value)) return null;
  const tokens = {} as MobileThemeSeedTokens;
  for (const key of MOBILE_THEME_TOKEN_KEYS) {
    const token = value[key];
    if (typeof token !== "string" || !hexToRgb(token)) return null;
    tokens[key] = token;
  }
  return tokens;
}

/** A theme block worth rendering, or null so the caller keeps the Alga pair. */
export function parseMobileTheme(value: unknown): MobileTheme | null {
  if (!isRecord(value)) return null;
  if (!isMobileThemePairId(value.pairId)) return null;
  if (typeof value.version !== "string" || value.version.length === 0) return null;

  const light = parseSeedTokens(value.light);
  const dark = parseSeedTokens(value.dark);
  if (!light || !dark) return null;

  return {
    pairId: value.pairId,
    label: typeof value.label === "string" && value.label.length > 0 ? value.label : value.pairId,
    light,
    dark,
    version: value.version,
  };
}
