import tinycolor from 'tinycolor2';
import { ITag } from 'server/src/interfaces/tag.interfaces';

interface ColorResult {
  background: string;
  text: string;
}

/**
 * Color Generation
 */
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

export const generateEntityColor = (str: string): ColorResult => {
  const hue = hashString(str) % 360;
  const baseColor = tinycolor({ h: hue, s: 85, l: 45 });
  
  return {
    background: tinycolor({ h: hue, s: 85, l: 92 }).toString(),
    text: tinycolor({ h: hue, s: 90, l: hue >= 30 && hue <= 210 ? 20 : 25 }).toString()
  };
};

export const generateAvatarColor = (str: string): ColorResult => {
  const hue = hashString(str) % 360;
  const color = tinycolor({ h: hue, s: 75, l: 60 });
  
  return {
    background: color.toHexString(),
    text: '#FFFFFF'
  };
};

/**
 * Color Utilities
 */
export const needsWhiteText = (backgroundColor: string): boolean => {
  return !tinycolor(backgroundColor).isLight();
};

export const getContrastColor = (backgroundColor: string): string => {
  return needsWhiteText(backgroundColor) ? '#FFFFFF' : '#000000';
};

export const generateColorPalette = (str: string, count: number = 5): string[] => {
  const hue = hashString(str) % 360;
  const baseColor = tinycolor({ h: hue, s: 75, l: 50 });
  return Array.from({ length: count }, (_, i) => {
    return baseColor.clone()
      .spin((i - Math.floor(count / 2)) * 20)
      .toHexString();
  });
};

/**
 * Tag Utilities
 */
export const getUniqueTagTexts = (tags: ITag[]): string[] => {
  const uniqueTags = new Set<string>();
  tags.forEach(tag => uniqueTags.add(tag.tag_text));
  return Array.from(uniqueTags).sort();
};

export const filterTagsByText = (tags: string[], searchText: string): string[] => {
  const search = searchText.toLowerCase().trim();
  if (!search) return tags;
  return tags.filter(tag => tag.toLowerCase().includes(search));
};

/**
 * Entity Display Utilities
 */
export const getAvatarUrl = (name: string, id: string, size: number = 40): string => {
  const colors = generateAvatarColor(id);
  const bg = colors.background.replace('#', '');
  const color = colors.text.replace('#', '');
  
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}
    &background=${bg}
    &color=${color}
    &size=${size}
    &bold=true`.replace(/\s+/g, '');
};

/**
 * Theme Constants
 */
export const THEME_COLORS = {
  primary: '#2563EB',
  secondary: '#7C3AED',
  success: '#059669',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#0D8ABC',
  // Add more theme colors as needed
} as const;

export const OPACITY_VALUES = {
  hover: 0.8,
  disabled: 0.5,
  overlay: 0.4,
} as const;

/**
 * Type Definitions
 */
export type ThemeColor = keyof typeof THEME_COLORS;
export type ColorOpacity = keyof typeof OPACITY_VALUES;

/**
 * Theme Helpers
 */
export const getThemeColor = (color: ThemeColor, opacity?: ColorOpacity): string => {
  const baseColor = tinycolor(THEME_COLORS[color]);
  if (opacity) {
    return baseColor.setAlpha(OPACITY_VALUES[opacity]).toRgbString();
  }
  return baseColor.toHexString();
};
