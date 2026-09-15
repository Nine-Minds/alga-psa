import type { TextStyle } from "react-native";
import { logger } from "../logging/logger";
import {
  brandRamp,
  contrastRatio,
  hexToRgb,
  mix,
  neutralRamp,
  rgbToHex,
  type Rgb,
  type ThemeMode,
} from "./themeMath";
import {
  DEFAULT_MOBILE_THEME_PAIR_ID,
  HIGH_CONTRAST_PAIR_ID,
  MOBILE_THEME_TOKEN_KEYS,
  type MobileThemePairId,
  type MobileThemeSeedTokens,
  type MobileThemeTokenKey,
} from "./themeTokens";

// ---------------------------------------------------------------------------
// Badge / Toast sub-types
// ---------------------------------------------------------------------------

export type BadgeColorSet = { bg: string; text: string; border: string };
export type ToastColorSet = { bg: string; text: string; border: string };

// ---------------------------------------------------------------------------
// Shadow type (cross-platform)
// ---------------------------------------------------------------------------

export type ShadowStyle = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

// ---------------------------------------------------------------------------
// Typography preset
// ---------------------------------------------------------------------------

export type TypographyPreset = {
  fontSize: number;
  fontWeight: TextStyle["fontWeight"];
  lineHeight?: number;
};

// ---------------------------------------------------------------------------
// Theme type
// ---------------------------------------------------------------------------

export type Theme = {
  mode: "light" | "dark";
  /** Tenant pair this theme was built from; 'alga' for the built-in fallback. */
  pairId: MobileThemePairId;
  /** The high-contrast pair asks for stronger borders and outlined badges. */
  highContrast: boolean;
  colors: {
    background: string;
    card: string;
    text: string;
    textSecondary: string;
    textInverse: string;
    primary: string;
    primaryLight: string;
    primaryDark: string;
    secondary: string;
    accent: string;
    border: string;
    borderLight: string;
    /** Emphasised border; what the high-contrast pair draws chrome with. */
    borderStrong: string;
    danger: string;
    warning: string;
    success: string;
    info: string;
    /** Activity-list accents aligned with the web main-app list (cyan=project task at the
     *  secondary-500 shade, plus time-entry orange and notification indigo). */
    orange: string;
    indigo: string;
    cyan: string;
    placeholder: string;
    shadow: string;
    /** Text and icons that sit on an intentionally black scrim (image preview, camera). */
    overlayText: string;
    badge: Record<"info" | "success" | "warning" | "danger" | "neutral", BadgeColorSet>;
    toast: Record<"info" | "success" | "error", ToastColorSet>;
  };
  spacing: {
    xxs: 2;
    xs: 4;
    sm: 8;
    md: 12;
    lg: 16;
    xl: 24;
    xxl: 32;
    xxxl: 48;
  };
  borderRadius: {
    sm: 4;
    md: 8;
    lg: 12;
    xl: 16;
    full: 999;
  };
  shadows: {
    sm: ShadowStyle;
    md: ShadowStyle;
    lg: ShadowStyle;
  };
  typography: {
    largeTitle: TypographyPreset;
    title: TypographyPreset;
    subtitle: TypographyPreset;
    body: TypographyPreset;
    bodyBold: TypographyPreset;
    caption: TypographyPreset;
    captionBold: TypographyPreset;
    small: TypographyPreset;
  };
};

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const spacing: Theme["spacing"] = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

const borderRadius: Theme["borderRadius"] = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 999,
} as const;

const typographyBase: Theme["typography"] = {
  largeTitle: { fontSize: 28, fontWeight: "700", lineHeight: 34 },
  title: { fontSize: 20, fontWeight: "600", lineHeight: 26 },
  subtitle: { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  body: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
  bodyBold: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: "400", lineHeight: 16 },
  captionBold: { fontSize: 12, fontWeight: "600", lineHeight: 16 },
  small: { fontSize: 10, fontWeight: "400", lineHeight: 14 },
} as const;

const shadowsByMode: Record<ThemeMode, Theme["shadows"]> = {
  light: {
    sm: { shadowColor: "#000000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
    md: { shadowColor: "#000000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
    lg: { shadowColor: "#000000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6 },
  },
  dark: {
    sm: { shadowColor: "#000000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2, elevation: 2 },
    md: { shadowColor: "#000000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 4 },
    lg: { shadowColor: "#000000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 8 },
  },
};

const WHITE = "#FFFFFF";
const BLACK: Rgb = [0, 0, 0];
const WHITE_RGB: Rgb = [255, 255, 255];

/**
 * Status colours are not part of a pair: the web emits them from the base
 * `:root`, so every pair shares them within a mode.
 */
const STATUS_COLORS: Record<ThemeMode, Record<"danger" | "warning" | "success" | "info" | "orange" | "indigo", string>> = {
  light: {
    danger: "#DC2626",
    warning: "#F59E0B",
    success: "#16A34A",
    info: "#2563EB",
    orange: "#F97316",
    indigo: "#6366F1",
  },
  dark: {
    danger: "#EF4444",
    warning: "#EAB308",
    success: "#4ABE78",
    info: "#3B82F6",
    orange: "#F97316",
    indigo: "#6366F1",
  },
};

/**
 * Badge and toast fills are mixed from the status colour and the pair's card so
 * they sit on dark pairs too. Ratios are fixed per mode (see SCRATCHPAD.md):
 * how far the fill and the border travel from the card toward the status
 * colour, and how far the label travels from the status colour toward black
 * (light) or white (dark).
 */
const STATUS_MIX: Record<ThemeMode, { bg: number; border: number; text: number }> = {
  light: { bg: 0.16, border: 0.45, text: 0.45 },
  dark: { bg: 0.26, border: 0.45, text: 0.6 },
};

/**
 * The only palette in the binary: the Alga pair, mirroring
 * CUSTOM_THEME_PRESETS.alga on the web. Every other pair arrives from the
 * server, and any token that fails to parse falls back to the value here.
 */
export const ALGA_THEME_TOKENS: Record<ThemeMode, MobileThemeSeedTokens> = {
  light: {
    background: "#f7f8fa",
    card: "#ffffff",
    surface: "#f8fafc",
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    textMuted: "#617086",
    border: "#e2e8f0",
    borderStrong: "#94a3b8",
    primary: "#8a4dea",
    secondary: "#40cff9",
    accent: "#ff9c30",
    sidebarBg: "#0c111d",
    sidebarText: "#f5f5f5",
    sidebarHover: "#808080",
    headerBg: "#ffffff",
  },
  dark: {
    background: "#0c0a18",
    card: "#1e1836",
    surface: "#130d24",
    textPrimary: "#e8e4f6",
    textSecondary: "#c9c3e0",
    textMuted: "#9a92b8",
    border: "#312952",
    borderStrong: "#4b3d73",
    primary: "#8a4dea",
    secondary: "#53d7fa",
    accent: "#ffa645",
    sidebarBg: "#151024",
    sidebarText: "#e8e4f6",
    sidebarHover: "#221743",
    headerBg: "#151024",
  },
};

// ---------------------------------------------------------------------------
// Theme engine
// ---------------------------------------------------------------------------

const loggedInvalidVersions = new Set<string>();

function resolveSeedTokens(
  tokens: Partial<MobileThemeSeedTokens> | null | undefined,
  mode: ThemeMode,
  version: string,
): Record<MobileThemeTokenKey, Rgb> {
  const resolved = {} as Record<MobileThemeTokenKey, Rgb>;
  const invalid: MobileThemeTokenKey[] = [];

  for (const key of MOBILE_THEME_TOKEN_KEYS) {
    const parsed = hexToRgb(tokens?.[key] ?? "");
    if (parsed) {
      resolved[key] = parsed;
      continue;
    }
    invalid.push(key);
    // Non-null: the embedded Alga preset is always valid hex.
    resolved[key] = hexToRgb(ALGA_THEME_TOKENS[mode][key]) as Rgb;
  }

  if (invalid.length > 0 && !loggedInvalidVersions.has(version)) {
    loggedInvalidVersions.add(version);
    logger.warn("theme.invalid_tokens", { version, mode, tokens: invalid });
  }

  return resolved;
}

export type BuildThemeOptions = {
  pairId?: MobileThemePairId;
  /** Cache key; the same version + mode returns the same Theme instance. */
  version?: string;
};

const themeCache = new Map<string, Theme>();
const THEME_CACHE_LIMIT = 8;

/**
 * Full mobile Theme from the 15 seed tokens of one mode. Never throws: an
 * unparseable token falls back to the Alga value for that mode.
 */
export function buildTheme(
  tokens: Partial<MobileThemeSeedTokens> | null | undefined,
  mode: ThemeMode,
  options: BuildThemeOptions = {},
): Theme {
  const pairId = options.pairId ?? DEFAULT_MOBILE_THEME_PAIR_ID;
  const version = options.version ?? pairId;
  const cacheKey = `${version}:${mode}`;
  const cached = themeCache.get(cacheKey);
  if (cached) return cached;

  const seed = resolveSeedTokens(tokens, mode, version);
  const hex = rgbToHex;

  const neutral = neutralRamp(seed, mode);
  const primaryRamp = brandRamp(seed.primary, mode);
  const secondaryRamp = brandRamp(seed.secondary, mode);

  const card = seed.card;
  const primary = hex(primaryRamp[5]);
  const status = STATUS_COLORS[mode];
  const ratios = STATUS_MIX[mode];
  const textAnchor = mode === "light" ? BLACK : WHITE_RGB;

  // White labels when they stay readable on the pair's primary. Dark pairs keep
  // a light textPrimary, so the fallback is only taken when it actually reads
  // better than white — the web checks its button labels at 3:1.
  const textPrimaryHex = hex(seed.textPrimary);
  const whiteOnPrimary = contrastRatio(WHITE, primary);
  const textInverse = whiteOnPrimary >= 4.5 || contrastRatio(textPrimaryHex, primary) <= whiteOnPrimary
    ? WHITE
    : textPrimaryHex;

  const statusSet = (color: string): BadgeColorSet => {
    const rgb = hexToRgb(color) as Rgb;
    return {
      bg: hex(mix(card, rgb, ratios.bg)),
      border: hex(mix(card, rgb, ratios.border)),
      text: hex(mix(rgb, textAnchor, ratios.text)),
    };
  };

  const theme: Theme = {
    mode,
    pairId,
    highContrast: pairId === HIGH_CONTRAST_PAIR_ID,
    colors: {
      background: hex(seed.background),
      card: hex(card),
      text: textPrimaryHex,
      textSecondary: hex(seed.textSecondary),
      textInverse,
      primary,
      primaryLight: hex(primaryRamp[2]),
      primaryDark: hex(primaryRamp[7]),
      secondary: hex(secondaryRamp[mode === "light" ? 7 : 3]),
      accent: hex(seed.accent),
      border: hex(seed.border),
      borderLight: hex(neutral[1]),
      borderStrong: hex(seed.borderStrong),
      danger: status.danger,
      warning: status.warning,
      success: status.success,
      info: status.info,
      orange: status.orange,
      indigo: status.indigo,
      cyan: hex(secondaryRamp[5]),
      placeholder: hex(seed.textMuted),
      shadow: "#000000",
      overlayText: WHITE,
      badge: {
        info: statusSet(status.info),
        success: statusSet(status.success),
        warning: statusSet(status.warning),
        danger: statusSet(status.danger),
        neutral: {
          bg: hex(neutral[1]),
          border: hex(neutral[2]),
          text: hex(neutral[mode === "light" ? 7 : 6]),
        },
      },
      toast: {
        info: { bg: hex(card), border: hex(seed.border), text: hex(seed.textPrimary) },
        success: statusSet(status.success),
        error: statusSet(status.danger),
      },
    },
    spacing,
    borderRadius,
    shadows: shadowsByMode[mode],
    typography: typographyBase,
  };

  if (themeCache.size >= THEME_CACHE_LIMIT) {
    // Keep the cache bounded; the oldest entry is the least likely active pair.
    const oldest = themeCache.keys().next().value;
    if (oldest !== undefined) themeCache.delete(oldest);
  }
  themeCache.set(cacheKey, theme);

  return theme;
}

// ---------------------------------------------------------------------------
// Built-in Alga pair — the fallback whenever no tenant theme is available
// ---------------------------------------------------------------------------

export const lightTheme: Theme = buildTheme(ALGA_THEME_TOKENS.light, "light", {
  pairId: DEFAULT_MOBILE_THEME_PAIR_ID,
  version: "builtin-alga",
});

export const darkTheme: Theme = buildTheme(ALGA_THEME_TOKENS.dark, "dark", {
  pairId: DEFAULT_MOBILE_THEME_PAIR_ID,
  version: "builtin-alga",
});
