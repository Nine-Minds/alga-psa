import { describe, expect, it } from "vitest";
import {
  brandRamp,
  contrastRatio,
  hexToRgb,
  mix,
  neutralRamp,
  rampFromStops,
  rgbToHex,
  type Rgb,
  type ThemeMode,
} from "./themeMath";
import fixtureJson from "./themeMath.fixture.json";

type FixtureRamps = { neutral: string[]; primary: string[]; secondary: string[]; accent: string[] };
type FixturePreset = {
  tokens: Record<ThemeMode, Record<string, string>>;
  light: FixtureRamps;
  dark: FixtureRamps;
};
const fixture = fixtureJson as unknown as {
  shades: number[];
  presets: Record<string, FixturePreset>;
};

const MODES: ThemeMode[] = ["light", "dark"];
const PAIR_IDS = Object.keys(fixture.presets);

const rgb = (hex: string): Rgb => {
  const parsed = hexToRgb(hex);
  if (!parsed) throw new Error(`Fixture hex did not parse: ${hex}`);
  return parsed;
};

const toHex = (ramp: Rgb[]): string[] => ramp.map(rgbToHex);

describe("themeMath.hexToRgb", () => {
  it("T012 accepts 3- and 6-digit hex with or without #", () => {
    expect(hexToRgb("#8a4dea")).toEqual([138, 77, 234]);
    expect(hexToRgb("8a4dea")).toEqual([138, 77, 234]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("f0a")).toEqual([255, 0, 170]);
  });

  it("T012 returns null for anything else", () => {
    for (const value of ["", "#12345", "rebeccapurple", "#gggggg", "rgb(1,2,3)"]) {
      expect(hexToRgb(value)).toBeNull();
    }
  });
});

describe("themeMath.mix", () => {
  it("T009 blends two colours by ratio", () => {
    expect(mix([0, 0, 0], [255, 255, 255], 0)).toEqual([0, 0, 0]);
    expect(mix([0, 0, 0], [255, 255, 255], 1)).toEqual([255, 255, 255]);
    expect(mix([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
  });

  it("T009 clamps to 0-255", () => {
    expect(mix([0, 0, 0], [255, 255, 255], 2)).toEqual([255, 255, 255]);
    expect(mix([10, 10, 10], [0, 0, 0], 3)).toEqual([0, 0, 0]);
  });
});

describe("themeMath.contrastRatio", () => {
  it("T013 returns 21 for black on white and the known 4.5 threshold pair", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    // #767676 on white is the canonical WCAG AA boundary colour.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.6);
  });

  it("returns 0 when a colour does not parse", () => {
    expect(contrastRatio("nope", "#ffffff")).toBe(0);
  });
});

describe("themeMath ramps against the web fixture", () => {
  it("T014 covers all nine presets in both modes with four ramps each", () => {
    expect(PAIR_IDS).toHaveLength(9);
    for (const pairId of PAIR_IDS) {
      for (const mode of MODES) {
        const ramps = fixture.presets[pairId][mode];
        for (const key of ["neutral", "primary", "secondary", "accent"] as const) {
          expect(ramps[key], `${pairId}/${mode}/${key}`).toHaveLength(10);
        }
      }
    }
  });

  it.each(PAIR_IDS.flatMap((pairId) => MODES.map((mode) => [pairId, mode] as const)))(
    "T010 rampFromStops reproduces the %s %s neutral ramp",
    (pairId, mode) => {
      const tokens = fixture.presets[pairId].tokens[mode];
      const ramp = neutralRamp(
        {
          background: rgb(tokens.background),
          card: rgb(tokens.card),
          surface: rgb(tokens.surface),
          border: rgb(tokens.border),
          borderStrong: rgb(tokens.borderStrong),
          textMuted: rgb(tokens.textMuted),
          textSecondary: rgb(tokens.textSecondary),
          textPrimary: rgb(tokens.textPrimary),
        },
        mode,
      );
      expect(toHex(ramp)).toEqual(fixture.presets[pairId][mode].neutral);
    },
  );

  it.each(PAIR_IDS.flatMap((pairId) => MODES.map((mode) => [pairId, mode] as const)))(
    "T011 brandRamp reproduces the %s %s brand ramps",
    (pairId, mode) => {
      const tokens = fixture.presets[pairId].tokens[mode];
      const expected = fixture.presets[pairId][mode];
      expect(toHex(brandRamp(rgb(tokens.primary), mode))).toEqual(expected.primary);
      expect(toHex(brandRamp(rgb(tokens.secondary), mode))).toEqual(expected.secondary);
      expect(toHex(brandRamp(rgb(tokens.accent), mode))).toEqual(expected.accent);
    },
  );

  it("T010 interpolates linearly between anchor stops", () => {
    const ramp = rampFromStops([
      [0, [0, 0, 0]],
      [1, [90, 180, 255]],
    ]);
    expect(ramp[0]).toEqual([0, 0, 0]);
    expect(ramp[9]).toEqual([90, 180, 255]);
    expect(ramp[3]).toEqual([30, 60, 85]);
  });
});
