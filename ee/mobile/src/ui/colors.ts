/**
 * Raw color palettes ported from the web app's globals.css.
 * These are the base color values — use themes.ts for semantic tokens.
 */

// Helper: convert space-separated RGB string "R G B" to hex "#RRGGBB"
function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Primary purple (#8a4dea) — light mode shades */
export const primaryLight = {
  50: rgbToHex(246, 240, 254),
  100: rgbToHex(237, 226, 253),
  200: rgbToHex(220, 197, 251),
  300: rgbToHex(202, 168, 249),
  400: rgbToHex(166, 115, 242),
  500: rgbToHex(138, 77, 234),
  600: rgbToHex(124, 69, 211),
  700: rgbToHex(110, 61, 187),
  800: rgbToHex(96, 54, 164),
  900: rgbToHex(82, 46, 140),
} as const;

/** Primary purple (#8a4dea) — dark mode shades */
export const primaryDark = {
  50: rgbToHex(82, 46, 140),
  100: rgbToHex(96, 54, 164),
  200: rgbToHex(110, 61, 187),
  300: rgbToHex(124, 69, 211),
  400: rgbToHex(138, 77, 234),
  500: rgbToHex(152, 85, 238),
  600: rgbToHex(166, 115, 242),
  700: rgbToHex(184, 145, 245),
  800: rgbToHex(202, 168, 249),
  900: rgbToHex(220, 197, 251),
} as const;

/** Secondary cyan (#40cff9) — light mode shades */
export const secondaryLight = {
  50: rgbToHex(236, 252, 254),
  100: rgbToHex(217, 249, 253),
  200: rgbToHex(179, 243, 251),
  300: rgbToHex(140, 236, 250),
  400: rgbToHex(102, 223, 251),
  500: rgbToHex(64, 207, 249),
  600: rgbToHex(58, 186, 224),
  700: rgbToHex(51, 166, 199),
  800: rgbToHex(45, 145, 174),
  900: rgbToHex(38, 124, 149),
} as const;

/** Secondary cyan (#40cff9) — dark mode shades */
export const secondaryDark = {
  50: rgbToHex(38, 124, 149),
  100: rgbToHex(45, 145, 174),
  200: rgbToHex(51, 166, 199),
  300: rgbToHex(58, 186, 224),
  400: rgbToHex(64, 207, 249),
  500: rgbToHex(83, 215, 250),
  600: rgbToHex(102, 223, 251),
  700: rgbToHex(140, 236, 250),
  800: rgbToHex(179, 243, 251),
  900: rgbToHex(217, 249, 253),
} as const;

/** Accent orange (#ff9c30) — light mode shades */
export const accentLight = {
  50: rgbToHex(255, 246, 230),
  100: rgbToHex(255, 237, 204),
  200: rgbToHex(255, 219, 153),
  300: rgbToHex(255, 201, 102),
  400: rgbToHex(255, 176, 89),
  500: rgbToHex(255, 156, 48),
  600: rgbToHex(230, 140, 43),
  700: rgbToHex(204, 125, 38),
  800: rgbToHex(179, 109, 33),
  900: rgbToHex(153, 94, 28),
} as const;

/** Accent orange (#ff9c30) — dark mode shades */
export const accentDark = {
  50: rgbToHex(45, 30, 12),
  100: rgbToHex(80, 50, 18),
  200: rgbToHex(204, 125, 38),
  300: rgbToHex(230, 140, 43),
  400: rgbToHex(255, 156, 48),
  500: rgbToHex(255, 166, 69),
  600: rgbToHex(255, 176, 89),
  700: rgbToHex(255, 201, 102),
  800: rgbToHex(255, 219, 153),
  900: rgbToHex(255, 237, 204),
} as const;

/** Gray scale — light mode (slate scale, high value = dark) */
export const grayLight = {
  50: rgbToHex(248, 250, 252),
  100: rgbToHex(241, 245, 249),
  200: rgbToHex(226, 232, 240),
  300: rgbToHex(203, 213, 225),
  400: rgbToHex(148, 163, 184),
  500: rgbToHex(100, 116, 139),
  600: rgbToHex(71, 85, 105),
  700: rgbToHex(51, 65, 85),
  800: rgbToHex(30, 41, 59),
  900: rgbToHex(15, 23, 42),
} as const;

/** Gray scale — dark mode (inverted slate scale) */
export const grayDark = {
  50: rgbToHex(15, 23, 42),
  100: rgbToHex(30, 41, 59),
  200: rgbToHex(51, 65, 85),
  300: rgbToHex(71, 85, 105),
  400: rgbToHex(100, 116, 139),
  500: rgbToHex(148, 163, 184),
  600: rgbToHex(203, 213, 225),
  700: rgbToHex(226, 232, 240),
  800: rgbToHex(241, 245, 249),
  900: rgbToHex(248, 250, 252),
} as const;

/** Semantic status colors */
export const status = {
  success: rgbToHex(34, 197, 94),
  warning: rgbToHex(245, 158, 11),
  error: rgbToHex(239, 68, 68),
  info: rgbToHex(59, 130, 246),
} as const;
