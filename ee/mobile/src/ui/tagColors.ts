// Tag chip colors, kept in lockstep with the web implementation
// (packages/tags/src/lib/colorUtils.ts and packages/ui/src/lib/colorUtils.ts)
// so a tag without stored colors renders identically on web and mobile.

export type TagColorSource = {
  tag_text: string;
  background_color?: string | null;
  text_color?: string | null;
};

export type TagChipColors = {
  backgroundColor: string;
  textColor: string;
  borderColor: string;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

export function generateEntityColor(name: string): { background: string; text: string } {
  const hue = hashString(name) % 360;
  return {
    background: hslToHex(hue, 85, 92),
    text: hslToHex(hue, 90, hue >= 30 && hue <= 210 ? 20 : 25),
  };
}

// Light pastel backgrounds become dark muted versions of the same hue and
// dark text becomes light, mirroring the web's dark-mode adaptation.
export function adaptColorsForDarkMode(colors: { background: string; text: string }): {
  background: string;
  text: string;
} {
  const bg = hexToHsl(colors.background);
  const txt = hexToHsl(colors.text);
  return {
    background:
      bg.l > 0.5 ? hslToHex(bg.h, Math.min(bg.s * 0.6, 0.5) * 100, 18) : colors.background,
    text: txt.l < 0.5 ? hslToHex(txt.h, Math.min(txt.s, 0.7) * 100, 78) : colors.text,
  };
}

export function getReadableTextColor(backgroundHex: string): string {
  const r = parseInt(backgroundHex.slice(1, 3), 16);
  const g = parseInt(backgroundHex.slice(3, 5), 16);
  const b = parseInt(backgroundHex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1F2937" : "#FFFFFF";
}

export function getTagChipColors(tag: TagColorSource, mode: "light" | "dark" = "light"): TagChipColors {
  const storedBackground =
    typeof tag.background_color === "string" && HEX_COLOR.test(tag.background_color)
      ? tag.background_color
      : null;

  let colors: { background: string; text: string };
  if (storedBackground) {
    const storedText =
      typeof tag.text_color === "string" && HEX_COLOR.test(tag.text_color)
        ? tag.text_color
        : getReadableTextColor(storedBackground);
    colors = { background: storedBackground, text: storedText };
  } else {
    colors = generateEntityColor(tag.tag_text);
  }

  if (mode === "dark") {
    colors = adaptColorsForDarkMode(colors);
  }

  return {
    backgroundColor: colors.background,
    textColor: colors.text,
    borderColor: colors.background,
  };
}
