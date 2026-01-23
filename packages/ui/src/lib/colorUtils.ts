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

export const generateAvatarColor = (str: string): ColorResult => {
  const hue = hashString(str) % 360;
  const color = tinycolor({ h: hue, s: 75, l: 60 });

  return {
    background: color.toHexString(),
    text: '#FFFFFF',
  };
};
