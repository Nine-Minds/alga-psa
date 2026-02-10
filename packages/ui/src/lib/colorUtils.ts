import tinycolor from 'tinycolor2';
import type { ITag } from '@alga-psa/types';

export interface ColorResult {
  background: string;
  text: string;
}

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

export const generateEntityColor = (tagOrString: string | ITag): ColorResult => {
  if (typeof tagOrString === 'object' && tagOrString.background_color && tagOrString.text_color) {
    return {
      background: tagOrString.background_color,
      text: tagOrString.text_color,
    };
  }

  const str = typeof tagOrString === 'string' ? tagOrString : tagOrString.tag_text;
  const hue = hashString(str) % 360;

  return {
    background: tinycolor({ h: hue, s: 85, l: 92 }).toHexString(),
    text: tinycolor({ h: hue, s: 90, l: hue >= 30 && hue <= 210 ? 20 : 25 }).toHexString(),
  };
};

/**
 * Adapt a color pair for dark mode display.
 * Light pastel backgrounds become dark muted versions of the same hue,
 * and dark text becomes light. The stored colors are never modified.
 */
export const adaptColorsForDarkMode = (colors: ColorResult): ColorResult => {
  const bg = tinycolor(colors.background);
  const txt = tinycolor(colors.text);
  const bgHsl = bg.toHsl();
  const txtHsl = txt.toHsl();

  // For light backgrounds (lightness > 50%), invert to a dark muted version
  const adaptedBg = bgHsl.l > 0.5
    ? tinycolor({ h: bgHsl.h, s: Math.min(bgHsl.s * 0.6, 0.5), l: 0.18 }).toHexString()
    : colors.background;

  // For dark text (lightness < 50%), lighten it for readability on dark bg
  const adaptedText = txtHsl.l < 0.5
    ? tinycolor({ h: txtHsl.h, s: Math.min(txtHsl.s, 0.7), l: 0.78 }).toHexString()
    : colors.text;

  return { background: adaptedBg, text: adaptedText };
};

export const generateAvatarColor = (str: string): ColorResult => {
  const hue = hashString(str) % 360;
  const color = tinycolor({ h: hue, s: 75, l: 60 });

  return {
    background: color.toHexString(),
    text: '#FFFFFF',
  };
};
