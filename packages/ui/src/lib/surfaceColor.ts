/**
 * Luminance at which white text stops out-contrasting black text, i.e. where a
 * surface flips from "dark" to "light" for artwork drawn on it.
 */
const LIGHT_SURFACE_LUMINANCE = 0.179;

/**
 * WCAG relative luminance of a colour the browser already resolved (`rgb(...)`),
 * of a bare `R G B` theme token, or of a hex value. Null when it cannot be read
 * or is fully transparent, which callers read as "do not guess".
 */
export function surfaceLuminance(color: string | null | undefined): number | null {
  if (!color) return null;

  const trimmed = color.trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  let channels: number[];

  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1];
    channels = [0, 2, 4].map((start) => parseInt(digits.slice(start, start + 2), 16));
  } else {
    const numbers = trimmed.match(/-?\d*\.?\d+%?/g);
    if (!numbers || numbers.length < 3) return null;
    // A see-through surface paints whatever is behind it, so it says nothing.
    if (numbers.length > 3 && parseFloat(numbers[3]) === 0) return null;
    channels = numbers.slice(0, 3).map((raw) => {
      const value = parseFloat(raw);
      return raw.endsWith('%') ? (value * 255) / 100 : value;
    });
  }

  if (channels.some((channel) => !Number.isFinite(channel))) return null;

  const [r, g, b] = channels.map((channel) => {
    const scaled = Math.min(Math.max(channel, 0), 255) / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** True when artwork on this surface should be drawn for a light background. */
export function isLightSurface(color: string | null | undefined): boolean {
  const luminance = surfaceLuminance(color);
  return luminance !== null && luminance > LIGHT_SURFACE_LUMINANCE;
}

/**
 * Picks the logo variant that matches the surface it lands on. Every shipped
 * theme paints a dark side panel, but a custom theme — and, in the client
 * portal, a hand-picked side-panel colour — can make it light, and then the
 * dark-background artwork is exactly the wrong one.
 */
export function pickLogoForSurface(
  lightVariant: string | null | undefined,
  darkVariant: string | null | undefined,
  surfaceIsLight: boolean,
): string | null {
  const preferred = surfaceIsLight ? lightVariant || darkVariant : darkVariant || lightVariant;
  return preferred || null;
}
