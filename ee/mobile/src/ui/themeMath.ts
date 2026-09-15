/**
 * Colour maths ported from packages/tenancy/src/lib/customTheme.ts.
 *
 * The mobile bundle cannot import @alga-psa/tenancy, so `mix`, `rampFromStops`,
 * `brandRamp` and the neutral-ramp derivation are copied here verbatim. A
 * fixture generated from the web implementation (themeMath.fixture.json) pins
 * the copy, so a change on the web that never reaches this file fails a test
 * rather than quietly repainting the phone.
 */

export type Rgb = [number, number, number];
export type ThemeMode = "light" | "dark";

const HEX_PATTERN = /^#?([a-f\d]{3}|[a-f\d]{6})$/i;

/** 3- and 6-digit hex, with or without `#`; anything else is null. */
export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_PATTERN.exec(hex ?? "");
  if (!match) return null;
  const digits = match[1].length === 3
    ? match[1].split("").map((c) => `${c}${c}`).join("")
    : match[1];
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
  ];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => clampChannel(c).toString(16).padStart(2, "0")).join("")}`;
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** Linear blend; `t` of 0 keeps `a`, 1 keeps `b`. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => clampChannel(a[i] + (b[i] - a[i]) * t)) as Rgb;
}

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Index of a shade in a ramp, e.g. shadeIndex(700) === 7. */
export const SHADE_INDEX: Record<number, number> = SHADES.reduce((acc, shade, index) => {
  acc[shade] = index;
  return acc;
}, {} as Record<number, number>);

/** Interpolate a 10-step ramp through positioned anchors (0 = shade 50, 1 = shade 900). */
export function rampFromStops(stops: Array<[number, Rgb]>): Rgb[] {
  return SHADES.map((_, index) => {
    const position = index / 9;
    let lower = stops[0];
    let upper = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i += 1) {
      if (position >= stops[i][0] && position <= stops[i + 1][0]) {
        lower = stops[i];
        upper = stops[i + 1];
        break;
      }
    }
    const span = upper[0] - lower[0];
    return mix(lower[1], upper[1], span === 0 ? 0 : (position - lower[0]) / span);
  });
}

/** Same ramp branding uses, so a custom pair and a branded portal agree on shades. */
export function brandRamp(base: Rgb, mode: ThemeMode): Rgb[] {
  const white: Rgb = [255, 255, 255];
  const scale = (factor: number): Rgb => base.map((c) => Math.round(c * factor)) as Rgb;
  const lightRamp: Rgb[] = [
    mix(base, white, 0.95),
    mix(base, white, 0.9),
    mix(base, white, 0.75),
    mix(base, white, 0.6),
    mix(base, white, 0.3),
    [...base] as Rgb,
    scale(0.85),
    scale(0.7),
    scale(0.5),
    scale(0.3),
  ];

  if (mode === "light") return lightRamp;

  // Dark keeps the inversion contract: *-50 stays the subtlest surface.
  return [
    lightRamp[9], lightRamp[8], lightRamp[7], lightRamp[6], lightRamp[4],
    lightRamp[5], lightRamp[3], lightRamp[2], lightRamp[1], lightRamp[0],
  ];
}

export type NeutralRampInput = {
  background: Rgb;
  card: Rgb;
  surface: Rgb;
  border: Rgb;
  borderStrong: Rgb;
  textMuted: Rgb;
  textSecondary: Rgb;
  textPrimary: Rgb;
};

const brightness = (color: Rgb) => color[0] + color[1] + color[2];

/**
 * Neutral ramp from the pair's surfaces and text. Shades 50 and 100 are large
 * surfaces in dark mode, so they are capped under the card: a palette whose
 * border is far lighter than its card would otherwise interpolate a ground that
 * swallows the cards standing on it.
 */
export function neutralRamp(tokens: NeutralRampInput, mode: ThemeMode): Rgb[] {
  const { background, card, surface, border, borderStrong, textMuted, textSecondary, textPrimary } = tokens;

  const lowStops: Array<[number, Rgb]> = (() => {
    const ground = mix(surface, border, 0.5);
    if (mode === "light" || brightness(ground) <= brightness(card)) {
      return [[0, surface], [2 / 9, border]];
    }
    const cappedGround = mix(background, card, 0.7);
    const well = brightness(surface) <= brightness(cappedGround) ? surface : mix(background, cappedGround, 0.5);
    return [[0, well], [1 / 9, cappedGround], [2 / 9, border]];
  })();

  return rampFromStops([
    ...lowStops,
    [3 / 9, borderStrong],
    [5 / 9, textMuted],
    [6 / 9, textSecondary],
    [1, textPrimary],
  ]);
}

export function relativeLuminance(rgb: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio between two hex colours; 0 when either fails to parse. */
export function contrastRatio(a: string, b: string): number {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return 0;
  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const [light, dark] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];
  return (light + 0.05) / (dark + 0.05);
}
