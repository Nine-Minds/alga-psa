import { describe, expect, it } from "vitest";
import { buildTheme } from "./themes";
import { contrastRatio } from "./themeMath";
import type { MobileThemePairId, MobileThemeSeedTokens } from "./themeTokens";
import fixtureJson from "./themeMath.fixture.json";

/**
 * The whole contract in one place: every predefined pair, both modes, built the
 * way the app builds them, checked against the ramps the web generated and
 * against the contrast bars the web enforces when a tenant saves a pair.
 */

type Ramps = { neutral: string[]; primary: string[]; secondary: string[]; accent: string[] };
const fixture = fixtureJson as unknown as {
  presets: Record<string, { tokens: Record<"light" | "dark", MobileThemeSeedTokens> } & Record<"light" | "dark", Ramps>>;
};

const PAIR_IDS = Object.keys(fixture.presets);
const MODES = ["light", "dark"] as const;
const CASES = PAIR_IDS.flatMap((pairId) => MODES.map((mode) => [pairId, mode] as const));

const themeFor = (pairId: string, mode: "light" | "dark") =>
  buildTheme(fixture.presets[pairId].tokens[mode], mode, {
    pairId: pairId as MobileThemePairId,
    version: `${pairId}-${mode}-contract`,
  });

/**
 * A tenant-authored palette (the Oz dev tenant's) whose border and secondary
 * text are both near black: any control that pairs two authored tokens for a
 * disabled state goes unreadable on it.
 */
const CUSTOM_PALETTE: Record<"light" | "dark", MobileThemeSeedTokens> = {
  light: {
    background: "#ffffff", card: "#ffffff", surface: "#ffffff",
    textPrimary: "#000000", textSecondary: "#1f2937", textMuted: "#374151",
    border: "#111111", borderStrong: "#1f2937",
    primary: "#1a1a1a", secondary: "#247024", accent: "#b45309",
    sidebarBg: "#000000", sidebarText: "#ffffff", sidebarHover: "#333333", headerBg: "#ffffff",
  },
  dark: {
    background: "#000000", card: "#000000", surface: "#000000",
    textPrimary: "#ffffff", textSecondary: "#e5e7eb", textMuted: "#d1d5db",
    border: "#f5f5f5", borderStrong: "#9ca3af",
    primary: "#737373", secondary: "#737373", accent: "#f59e0b",
    sidebarBg: "#000000", sidebarText: "#ffffff", sidebarHover: "#333333", headerBg: "#000000",
  },
};

/** The bars the web applies in validateCustomThemeContrast, plus the mobile-only disabled surfaces. */
function expectReadable(colors: ReturnType<typeof buildTheme>["colors"]) {
  // Body text at 4.5:1, muted text and button labels at 3:1.
  expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.text, colors.card)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.textSecondary, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.textSecondary, colors.card)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.placeholder, colors.background)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(colors.primary, colors.background)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(colors.textInverse, colors.primary)).toBeGreaterThanOrEqual(3);

  // Disabled controls (PrimaryButton, SecondaryButton, TextInput, ListRow all
  // paint disabled.bg/text): the label must read, and the surface must still
  // be distinguishable from an enabled card.
  expect(contrastRatio(colors.disabled.text, colors.disabled.bg), "disabled label").toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.disabled.bg, colors.card), "disabled surface vs card").toBeGreaterThanOrEqual(1.1);

  for (const tone of ["info", "success", "warning", "danger", "neutral"] as const) {
    const badge = colors.badge[tone];
    expect(contrastRatio(badge.text, badge.bg), tone).toBeGreaterThanOrEqual(4.5);
  }
  for (const tone of ["info", "success", "error"] as const) {
    const toast = colors.toast[tone];
    expect(contrastRatio(toast.text, toast.bg), tone).toBeGreaterThanOrEqual(4.5);
  }
}

describe("theme pair contract", () => {
  it("covers all nine predefined pairs", () => {
    expect(PAIR_IDS).toEqual([
      "alga",
      "slate",
      "ocean",
      "sky",
      "forest",
      "sunset",
      "cappuccino",
      "vice",
      "high-contrast",
    ]);
  });

  it.each(CASES)("T058 maps the %s %s pair onto the web's tokens and ramps", (pairId, mode) => {
    const theme = themeFor(pairId, mode);
    const seeds = fixture.presets[pairId].tokens[mode];
    const ramps = fixture.presets[pairId][mode];

    expect(theme.colors.background).toBe(seeds.background);
    expect(theme.colors.card).toBe(seeds.card);
    expect(theme.colors.text).toBe(seeds.textPrimary);
    expect(theme.colors.textSecondary).toBe(seeds.textSecondary);
    expect(theme.colors.placeholder).toBe(seeds.textMuted);
    expect(theme.colors.border).toBe(seeds.border);
    expect(theme.colors.borderStrong).toBe(seeds.borderStrong);
    expect(theme.colors.accent).toBe(seeds.accent);

    expect(theme.colors.borderLight).toBe(ramps.neutral[1]);
    expect(theme.colors.primary).toBe(ramps.primary[5]);
    expect(theme.colors.primaryLight).toBe(ramps.primary[2]);
    expect(theme.colors.primaryDark).toBe(ramps.primary[7]);
    expect(theme.colors.secondary).toBe(ramps.secondary[mode === "light" ? 7 : 3]);
    expect(theme.colors.cyan).toBe(ramps.secondary[5]);

    expect(theme.mode).toBe(mode);
    expect(theme.pairId).toBe(pairId);
  });

  it.each(CASES)("T059 keeps the %s %s pair readable", (pairId, mode) => {
    expectReadable(themeFor(pairId, mode).colors);
  });

  it.each(MODES)("T060 keeps a tenant custom palette readable in %s mode, disabled controls included", (mode) => {
    const { colors } = buildTheme(CUSTOM_PALETTE[mode], mode, { pairId: "custom", version: `custom-${mode}-contract` });
    expectReadable(colors);
    // The authored pairing the old PrimaryButton used is exactly what fails here.
    expect(contrastRatio(colors.textSecondary, colors.border)).toBeLessThan(4.5);
  });
});
