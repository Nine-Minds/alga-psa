import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ALGA_THEME_TOKENS, buildTheme, darkTheme, lightTheme } from "./themes";
import { contrastRatio } from "./themeMath";
import type { MobileThemePairId, MobileThemeSeedTokens } from "./themeTokens";
import fixtureJson from "./themeMath.fixture.json";

const fixture = fixtureJson as unknown as {
  presets: Record<string, {
    tokens: Record<"light" | "dark", MobileThemeSeedTokens>;
    light: { neutral: string[]; primary: string[]; secondary: string[]; accent: string[] };
    dark: { neutral: string[]; primary: string[]; secondary: string[]; accent: string[] };
  }>;
};

const preset = (pairId: string, mode: "light" | "dark") =>
  buildTheme(fixture.presets[pairId].tokens[mode], mode, {
    pairId: pairId as MobileThemePairId,
    version: `${pairId}-${mode}-engine`,
  });

describe("buildTheme structure", () => {
  it("T016 keeps spacing, radii, shadows and typography identical to the built-in theme", () => {
    const forest = preset("forest", "light");
    expect(forest.spacing).toEqual(lightTheme.spacing);
    expect(forest.borderRadius).toEqual(lightTheme.borderRadius);
    expect(forest.shadows).toEqual(lightTheme.shadows);
    expect(forest.typography).toEqual(lightTheme.typography);
    expect(preset("forest", "dark").shadows).toEqual(darkTheme.shadows);
  });

  it("T028 still exports lightTheme and darkTheme with matching colour keys", () => {
    expect(lightTheme.mode).toBe("light");
    expect(darkTheme.mode).toBe("dark");
    expect(Object.keys(lightTheme.colors).sort()).toEqual(Object.keys(darkTheme.colors).sort());
  });
});

describe("buildTheme token mapping", () => {
  it("T017 builds the Alga light pair from the embedded seed tokens", () => {
    expect(lightTheme.colors.background).toBe(ALGA_THEME_TOKENS.light.background);
    expect(lightTheme.colors.card).toBe(ALGA_THEME_TOKENS.light.card);
    expect(lightTheme.colors.text).toBe(ALGA_THEME_TOKENS.light.textPrimary);
    expect(lightTheme.colors.textSecondary).toBe(ALGA_THEME_TOKENS.light.textSecondary);
    expect(lightTheme.colors.border).toBe(ALGA_THEME_TOKENS.light.border);
    expect(lightTheme.colors.placeholder).toBe(ALGA_THEME_TOKENS.light.textMuted);
    // The purple the app has always shipped.
    expect(lightTheme.colors.primary).toBe("#8a4dea");
    expect(lightTheme.colors.borderLight).toBe(fixture.presets.alga.light.neutral[1]);
  });

  it("T018 builds the Alga dark pair from the embedded seed tokens", () => {
    expect(darkTheme.colors.background).toBe(ALGA_THEME_TOKENS.dark.background);
    expect(darkTheme.colors.card).toBe(ALGA_THEME_TOKENS.dark.card);
    expect(darkTheme.colors.text).toBe(ALGA_THEME_TOKENS.dark.textPrimary);
    expect(darkTheme.colors.textSecondary).toBe(ALGA_THEME_TOKENS.dark.textSecondary);
    expect(darkTheme.colors.border).toBe(ALGA_THEME_TOKENS.dark.border);
    expect(darkTheme.colors.primary).toBe("#8a4dea");
    expect(darkTheme.colors.borderLight).toBe(fixture.presets.alga.dark.neutral[1]);
  });

  it("T019 takes primary, primaryLight and primaryDark from the Forest primary ramp", () => {
    const forest = preset("forest", "light");
    const ramp = fixture.presets.forest.light.primary;
    expect(forest.colors.primary).toBe(ramp[5]);
    expect(forest.colors.primaryLight).toBe(ramp[2]);
    expect(forest.colors.primaryDark).toBe(ramp[7]);
  });

  it("T020 keeps borderLight under the card on the Vice dark pair", () => {
    const vice = preset("vice", "dark");
    const brightness = (hex: string) =>
      [1, 3, 5].reduce((sum, index) => sum + parseInt(hex.slice(index, index + 2), 16), 0);
    expect(brightness(vice.colors.borderLight)).toBeLessThan(brightness(vice.colors.card));
  });

  it("T021 picks white inverse text on the Alga primary and dark text on a pale custom primary", () => {
    expect(lightTheme.colors.textInverse.toLowerCase()).toBe("#ffffff");

    const pale: MobileThemeSeedTokens = { ...ALGA_THEME_TOKENS.light, primary: "#ffe066" };
    const paleTheme = buildTheme(pale, "light", { pairId: "custom", version: "pale-primary" });
    expect(paleTheme.colors.textInverse).toBe(ALGA_THEME_TOKENS.light.textPrimary);
  });

  it("T022 takes secondary and cyan from the secondary ramp per mode", () => {
    const light = preset("ocean", "light");
    const dark = preset("ocean", "dark");
    expect(light.colors.secondary).toBe(fixture.presets.ocean.light.secondary[7]);
    expect(light.colors.cyan).toBe(fixture.presets.ocean.light.secondary[5]);
    expect(dark.colors.secondary).toBe(fixture.presets.ocean.dark.secondary[3]);
    expect(dark.colors.cyan).toBe(fixture.presets.ocean.dark.secondary[5]);
    expect(light.colors.accent).toBe(fixture.presets.ocean.light.accent[5]);
  });

  it("T023 keeps status colours identical across every pair within a mode", () => {
    for (const mode of ["light", "dark"] as const) {
      const reference = mode === "light" ? lightTheme : darkTheme;
      for (const pairId of Object.keys(fixture.presets)) {
        const theme = preset(pairId, mode);
        expect(theme.colors.danger).toBe(reference.colors.danger);
        expect(theme.colors.warning).toBe(reference.colors.warning);
        expect(theme.colors.success).toBe(reference.colors.success);
        expect(theme.colors.info).toBe(reference.colors.info);
        expect(theme.colors.orange).toBe(reference.colors.orange);
        expect(theme.colors.indigo).toBe(reference.colors.indigo);
      }
    }
  });
});

describe("buildTheme badges and toasts", () => {
  it("T024 mixes badge fills with the pair's card and keeps labels readable", () => {
    const forestLight = preset("forest", "light");
    const forestDark = preset("forest", "dark");
    expect(forestLight.colors.badge.info.bg).not.toBe(forestDark.colors.badge.info.bg);

    for (const pairId of Object.keys(fixture.presets)) {
      for (const mode of ["light", "dark"] as const) {
        const badge = preset(pairId, mode).colors.badge;
        for (const tone of ["info", "success", "warning", "danger", "neutral"] as const) {
          expect(
            contrastRatio(badge[tone].text, badge[tone].bg),
            `${pairId}/${mode}/${tone}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("T025 derives toasts from the status colours and the card", () => {
    const vice = preset("vice", "dark");
    expect(vice.colors.toast.success).toEqual(vice.colors.badge.success);
    expect(vice.colors.toast.error).toEqual(vice.colors.badge.danger);
    expect(vice.colors.toast.info.bg).toBe(vice.colors.card);
    expect(vice.colors.toast.info.border).toBe(vice.colors.border);
  });
});

describe("buildTheme resilience", () => {
  it("T026 substitutes the Alga value for a token that fails to parse", () => {
    const broken = { ...ALGA_THEME_TOKENS.light, border: "not-a-colour", card: "#101010" };
    const theme = buildTheme(broken, "light", { pairId: "custom", version: "broken-border-1" });
    expect(theme.colors.border).toBe(ALGA_THEME_TOKENS.light.border);
    expect(theme.colors.card).toBe("#101010");
  });

  it("T026 survives a completely empty token set", () => {
    const theme = buildTheme({}, "dark", { pairId: "custom", version: "empty-tokens" });
    expect(theme.colors.background).toBe(ALGA_THEME_TOKENS.dark.background);
    expect(theme.colors.primary).toBe(darkTheme.colors.primary);
  });

  it("T027 logs invalid tokens once per version", async () => {
    const { logger } = await import("../logging/logger");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const broken = { ...ALGA_THEME_TOKENS.light, border: "nope" };

    buildTheme(broken, "light", { pairId: "custom", version: "broken-once" });
    buildTheme(broken, "dark", { pairId: "custom", version: "broken-once" });
    buildTheme({ ...broken, card: "also-nope" }, "light", { pairId: "custom", version: "broken-once" });

    expect(warn.mock.calls.filter(([message]) => message === "theme.invalid_tokens")).toHaveLength(1);
    warn.mockRestore();
  });

  it("T034 returns the same Theme instance for the same version and mode", () => {
    const tokens = fixture.presets.sky.tokens.light;
    expect(buildTheme(tokens, "light", { pairId: "sky", version: "sky-memo" }))
      .toBe(buildTheme(tokens, "light", { pairId: "sky", version: "sky-memo" }));
  });
});

describe("shipped palettes", () => {
  it("T029 embeds no pair other than Alga anywhere under src/", () => {
    const algaValues = new Set(
      [...Object.values(ALGA_THEME_TOKENS.light), ...Object.values(ALGA_THEME_TOKENS.dark)]
        .map((value) => value.toLowerCase()),
    );
    const otherPairValues = new Set<string>();
    for (const [pairId, entry] of Object.entries(fixture.presets)) {
      if (pairId === "alga") continue;
      for (const mode of ["light", "dark"] as const) {
        for (const value of Object.values(entry.tokens[mode])) {
          const lower = value.toLowerCase();
          if (!algaValues.has(lower)) otherPairValues.add(lower);
        }
      }
    }

    // Same allow-list as the ESLint hex rule: themes.ts holds the Alga seeds and
    // the web's status colours, colors.ts/tagColors.ts are palette files,
    // Avatar.tsx is the identity palette and the editor HTML is generated.
    const allowed = new Set([
      "themes.ts",
      "colors.ts",
      "tagColors.ts",
      "Avatar.tsx",
      "generatedEditorHtml.ts",
    ]);
    const srcDir = path.resolve(__dirname, "..");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\.test\.tsx?$/.test(entry.name)) continue;
        if (allowed.has(entry.name)) continue;
        const contents = fs.readFileSync(full, "utf8").toLowerCase();
        for (const value of otherPairValues) {
          if (contents.includes(value)) offenders.push(`${path.relative(srcDir, full)} → ${value}`);
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});
