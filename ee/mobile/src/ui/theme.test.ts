import { describe, expect, it } from "vitest";
import { lightTheme, darkTheme, type Theme } from "./themes";

/**
 * Legacy compat: re-derive the old `colors`, `spacing`, `typography` exports
 * from lightTheme so we can test them without pulling in expo-secure-store
 * (which ThemeContext.tsx transitively requires and fails in vitest).
 */
const colors = {
  background: lightTheme.colors.background,
  text: lightTheme.colors.text,
  mutedText: lightTheme.colors.textSecondary,
  danger: lightTheme.colors.danger,
  card: lightTheme.colors.card,
  border: lightTheme.colors.border,
  primary: lightTheme.colors.primary,
  primaryText: lightTheme.colors.textInverse,
} as const;

const spacing = lightTheme.spacing;

const typography = {
  title: { fontSize: lightTheme.typography.title.fontSize, fontWeight: lightTheme.typography.title.fontWeight },
  body: { fontSize: lightTheme.typography.body.fontSize, fontWeight: lightTheme.typography.body.fontWeight },
  caption: { fontSize: lightTheme.typography.caption.fontSize, fontWeight: lightTheme.typography.caption.fontWeight },
} as const;

describe("theme primitives (legacy re-exports)", () => {
  it("exports expected color tokens", () => {
    expect(colors.background).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(colors.text).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(colors.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(colors.primaryText).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(colors.border).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("exports spacing scale in ascending order", () => {
    expect(spacing.xs).toBeLessThan(spacing.sm);
    expect(spacing.sm).toBeLessThan(spacing.md);
    expect(spacing.md).toBeLessThan(spacing.lg);
    expect(spacing.lg).toBeLessThan(spacing.xl);
  });

  it("exports basic typography presets", () => {
    expect(typography.title.fontSize).toBeGreaterThan(typography.body.fontSize);
    expect(typography.caption.fontSize).toBeLessThan(typography.body.fontSize);
  });
});

describe("lightTheme", () => {
  it("has mode light", () => {
    expect(lightTheme.mode).toBe("light");
  });

  it("has all required color keys", () => {
    const requiredKeys: (keyof Theme["colors"])[] = [
      "background",
      "card",
      "text",
      "textSecondary",
      "textInverse",
      "primary",
      "primaryLight",
      "primaryDark",
      "secondary",
      "accent",
      "border",
      "borderLight",
      "danger",
      "warning",
      "success",
      "info",
      "placeholder",
      "shadow",
      "badge",
      "toast",
    ];
    for (const key of requiredKeys) {
      expect(lightTheme.colors).toHaveProperty(key);
    }
  });

  it("has badge tones", () => {
    const tones: (keyof Theme["colors"]["badge"])[] = ["info", "success", "warning", "danger", "neutral"];
    for (const tone of tones) {
      expect(lightTheme.colors.badge[tone]).toHaveProperty("bg");
      expect(lightTheme.colors.badge[tone]).toHaveProperty("text");
      expect(lightTheme.colors.badge[tone]).toHaveProperty("border");
    }
  });

  it("has toast tones", () => {
    const tones: (keyof Theme["colors"]["toast"])[] = ["info", "success", "error"];
    for (const tone of tones) {
      expect(lightTheme.colors.toast[tone]).toHaveProperty("bg");
      expect(lightTheme.colors.toast[tone]).toHaveProperty("text");
      expect(lightTheme.colors.toast[tone]).toHaveProperty("border");
    }
  });

  it("has spacing scale", () => {
    expect(lightTheme.spacing.xxs).toBe(2);
    expect(lightTheme.spacing.xs).toBe(4);
    expect(lightTheme.spacing.sm).toBe(8);
    expect(lightTheme.spacing.md).toBe(12);
    expect(lightTheme.spacing.lg).toBe(16);
    expect(lightTheme.spacing.xl).toBe(24);
    expect(lightTheme.spacing.xxl).toBe(32);
    expect(lightTheme.spacing.xxxl).toBe(48);
  });

  it("has border radius tokens", () => {
    expect(lightTheme.borderRadius.sm).toBe(4);
    expect(lightTheme.borderRadius.md).toBe(8);
    expect(lightTheme.borderRadius.lg).toBe(12);
    expect(lightTheme.borderRadius.xl).toBe(16);
    expect(lightTheme.borderRadius.full).toBe(999);
  });

  it("has shadow presets", () => {
    expect(lightTheme.shadows.sm.elevation).toBeGreaterThan(0);
    expect(lightTheme.shadows.md.elevation).toBeGreaterThan(lightTheme.shadows.sm.elevation);
    expect(lightTheme.shadows.lg.elevation).toBeGreaterThan(lightTheme.shadows.md.elevation);
  });

  it("has typography presets", () => {
    expect(lightTheme.typography.largeTitle.fontSize).toBeGreaterThan(lightTheme.typography.title.fontSize);
    expect(lightTheme.typography.title.fontSize).toBeGreaterThan(lightTheme.typography.body.fontSize);
    expect(lightTheme.typography.caption.fontSize).toBeLessThan(lightTheme.typography.body.fontSize);
    expect(lightTheme.typography.small.fontSize).toBeLessThan(lightTheme.typography.caption.fontSize);
  });
});

describe("darkTheme", () => {
  it("has mode dark", () => {
    expect(darkTheme.mode).toBe("dark");
  });

  it("has a dark background", () => {
    expect(darkTheme.colors.background).toBe("#000000");
  });

  it("has all required color keys matching lightTheme structure", () => {
    const lightKeys = Object.keys(lightTheme.colors);
    const darkKeys = Object.keys(darkTheme.colors);
    expect(darkKeys.sort()).toEqual(lightKeys.sort());
  });

  it("shares the same spacing scale", () => {
    expect(darkTheme.spacing).toEqual(lightTheme.spacing);
  });

  it("shares the same border radius tokens", () => {
    expect(darkTheme.borderRadius).toEqual(lightTheme.borderRadius);
  });
});
