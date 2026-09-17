import { describe, expect, it } from "vitest";
import { describeThemePair, nextThemePreference } from "./settingsAppearance";
import settingsEn from "../i18n/locales/en/settings.json";

const t = (key: string, defaultValue: string) => {
  const value = key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    settingsEn,
  );
  return typeof value === "string" ? value : defaultValue;
};

describe("settings appearance", () => {
  it("T042 cycles System → Light → Dark → System", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });

  it("T044 shows the pair label for a predefined pair", () => {
    expect(describeThemePair("Forest", t)).toBe("Forest");
    expect(describeThemePair("High contrast", t)).toBe("High contrast");
  });

  it("T045 shows Custom for a custom pair and Default with no theme block", () => {
    expect(describeThemePair("Custom", t)).toBe("Custom");
    expect(describeThemePair(null, t)).toBe("Default");
  });

  it("T046 resolves every Appearance string from settings.json", () => {
    const appearance = (settingsEn as Record<string, any>).appearance;
    expect((settingsEn as Record<string, any>).sections.appearance).toBe("Appearance");
    expect(appearance.mode).toBeTruthy();
    expect(appearance.modeHint).toBeTruthy();
    expect(appearance.theme).toBeTruthy();
    expect(appearance.themeDefault).toBe("Default");
    expect(appearance.themeCustom).toBe("Custom");
    expect(appearance.themeHint).toBe("Set by your administrator in AlgaPSA settings");
    for (const mode of ["system", "light", "dark"] as const) {
      expect(appearance.modes[mode]).toBeTruthy();
    }
  });
});
