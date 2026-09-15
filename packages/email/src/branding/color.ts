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
