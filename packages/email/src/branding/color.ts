/** Minimal hex/HSL helpers for deriving an email palette from one or two colors. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_PATTERN.test(value.trim());
}

/** Expands `#abc` to `#aabbcc` and lower-cases. Returns null for anything else. */
export function normalizeHex(value: string): string | null {
  const match = HEX_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  return digits.length === 3
    ? `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`
    : `#${digits}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clampByte(c).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;

  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): Rgb {
  if (s === 0) {
    const value = l * 255;
    return { r: value, g: value, b: value };
  }

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;

  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] :
    [c, 0, x];

  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/** Scales HSL lightness by `factor` (0.75 darkens 25%, 1.18 lightens 18%). */
export function scaleLightness(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  return rgbToHex(hslToRgb({ ...hsl, l: Math.max(0, Math.min(1, hsl.l * factor)) }));
}

/** Mixes `hex` with white; `whiteRatio` 0.95 means 95% white, 5% color. */
export function mixWithWhite(hex: string, whiteRatio: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const ratio = Math.max(0, Math.min(1, whiteRatio));
  const mix = (channel: number) => channel * (1 - ratio) + 255 * ratio;
  return rgbToHex({ r: mix(rgb.r), g: mix(rgb.g), b: mix(rgb.b) });
}

export function rgbaString(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${clampByte(rgb.r)},${clampByte(rgb.g)},${clampByte(rgb.b)},${alpha})`;
}

/**
 * Luminance at which white artwork stops out-contrasting black artwork, i.e.
 * where a surface flips from "dark" to "light" for whatever is drawn on it.
 * Mirrors packages/ui/src/lib/surfaceColor.ts, which the app shell uses for the
 * same choice — copied rather than imported so this package keeps resolving for
 * Node consumers such as the Temporal worker.
 */
const LIGHT_SURFACE_LUMINANCE = 0.179;

/** WCAG relative luminance of a hex color; null when it cannot be read. */
export function relativeLuminance(hex: string | null | undefined): number | null {
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return null;

  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const scaled = Math.min(Math.max(channel, 0), 255) / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** True when artwork on this surface should be drawn for a dark background. */
export function isDarkSurface(hex: string | null | undefined): boolean {
  const luminance = relativeLuminance(hex);
  return luminance !== null && luminance <= LIGHT_SURFACE_LUMINANCE;
}

/**
 * Whether the gradient header of a branded template is a dark surface.
 *
 * Judged on the mean of the two stops, which is both the middle of the gradient
 * and near the flat `bgcolor` the clients that drop `linear-gradient` paint
 * instead. Single-color mode carries no secondary, so the primary stands alone.
 */
export function isDarkEmailHeader(palette: { primary: string; secondary?: string | null }): boolean {
  const primary = hexToRgb(palette.primary);
  if (!primary) return false;

  const secondary = palette.secondary ? hexToRgb(palette.secondary) : null;
  const mean = secondary
    ? { r: (primary.r + secondary.r) / 2, g: (primary.g + secondary.g) / 2, b: (primary.b + secondary.b) / 2 }
    : primary;

  return isDarkSurface(rgbToHex(mean));
}
