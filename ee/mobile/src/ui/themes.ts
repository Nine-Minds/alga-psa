import type { TextStyle } from "react-native";
import {
  primaryLight,
  primaryDark,
  secondaryLight,
  secondaryDark,
  accentLight,
  accentDark,
  grayLight,
  grayDark,
} from "./colors";

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
    danger: string;
    warning: string;
    success: string;
    info: string;
    placeholder: string;
    shadow: string;
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

// ---------------------------------------------------------------------------
// Light theme
// ---------------------------------------------------------------------------

export const lightTheme: Theme = {
  mode: "light",
  colors: {
    background: "#FFFFFF",
    card: grayLight[50],
    text: grayLight[900],
    textSecondary: grayLight[500],
    textInverse: "#FFFFFF",
    primary: primaryLight[500],
    primaryLight: primaryLight[200],
    primaryDark: primaryLight[700],
    secondary: secondaryLight[700],
    accent: accentLight[500],
    border: grayLight[200],
    borderLight: grayLight[100],
    danger: "#DC2626",
    warning: "#F59E0B",
    success: "#16A34A",
    info: "#2563EB",
    placeholder: grayLight[400],
    shadow: "#000000",
    badge: {
      info: { bg: "#DBEAFE", border: "#93C5FD", text: "#1E3A8A" },
      success: { bg: "#DCFCE7", border: "#86EFAC", text: "#14532D" },
      warning: { bg: "#FEF3C7", border: "#FDE68A", text: "#92400E" },
      danger: { bg: "#FEE2E2", border: "#FCA5A5", text: "#7F1D1D" },
      neutral: { bg: grayLight[100], border: grayLight[200], text: grayLight[700] },
    },
    toast: {
      info: { bg: grayLight[50], border: grayLight[200], text: grayLight[900] },
      success: { bg: "#DCFCE7", border: "#86EFAC", text: "#14532D" },
      error: { bg: "#FEE2E2", border: "#FCA5A5", text: "#7F1D1D" },
    },
  },
  spacing,
  borderRadius,
  shadows: {
    sm: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    md: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    lg: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 6,
    },
  },
  typography: typographyBase,
};

// ---------------------------------------------------------------------------
// Dark theme
// ---------------------------------------------------------------------------

export const darkTheme: Theme = {
  mode: "dark",
  colors: {
    background: "#000000",
    card: "#161C30",
    text: grayDark[900],
    textSecondary: grayDark[500],
    textInverse: "#000000",
    primary: primaryDark[500],
    primaryLight: primaryDark[700],
    primaryDark: primaryDark[300],
    secondary: secondaryDark[500],
    accent: accentDark[500],
    border: grayDark[200],
    borderLight: grayDark[100],
    danger: "#EF4444",
    warning: "#EAB308",
    success: "#4ABE78",
    info: "#3B82F6",
    placeholder: grayDark[400],
    shadow: "#000000",
    badge: {
      info: { bg: "#1E3A8A", border: "#1E40AF", text: "#BFDBFE" },
      success: { bg: "#14532D", border: "#166534", text: "#86EFAC" },
      warning: { bg: "#372606", border: "#EAB308", text: "#FDE047" },
      danger: { bg: "#7F1D1D", border: "#991B1B", text: "#FECACA" },
      neutral: { bg: grayDark[100], border: grayDark[200], text: grayDark[600] },
    },
    toast: {
      info: { bg: grayDark[100], border: grayDark[200], text: grayDark[900] },
      success: { bg: "#14532D", border: "#166534", text: "#86EFAC" },
      error: { bg: "#7F1D1D", border: "#991B1B", text: "#FECACA" },
    },
  },
  spacing,
  borderRadius,
  shadows: {
    sm: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.3,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.4,
      shadowRadius: 4,
      elevation: 4,
    },
    lg: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.5,
      shadowRadius: 8,
      elevation: 8,
    },
  },
  typography: typographyBase,
};
