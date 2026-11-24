import { isHexColor, normalizeHex } from './color';
import type { EmailBrandingLogo, EmailBrandingPalette, EmailPaletteTokens } from './types';

/** The logo block as persisted or submitted; only an explicit pin survives, auto is the absence of one. */
export function readBrandLogo(raw: unknown): EmailBrandingLogo | null {
  const value = raw as Record<string, any> | null | undefined;
  if (value?.variant !== 'wide' && value?.variant !== 'default') return null;
  return {
    variant: value.variant,
    ...(value.artwork === 'light' || value.artwork === 'dark' ? { artwork: value.artwork } : {}),
  };
}

/** Reads the persisted palette, ignoring a blob that carries no usable primary. */
export function readEmailBrandingPalette(raw: unknown): EmailBrandingPalette | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, any>;
  if (!isHexColor(value.primary)) return null;
  const logo = readBrandLogo(value.logo);

  return {
    primary: normalizeHex(value.primary)!,
    secondary: isHexColor(value.secondary) ? normalizeHex(value.secondary)! : null,
    ...(value.overrides && typeof value.overrides === 'object' ? { overrides: value.overrides } : {}),
    ...(logo ? { logo } : {}),
    ...(value.hideAttribution === true ? { hideAttribution: true } : {}),
    ...(typeof value.appliedAt === 'string' ? { appliedAt: value.appliedAt } : {}),
    ...(value.appliedPalette && typeof value.appliedPalette === 'object'
      ? { appliedPalette: value.appliedPalette as EmailPaletteTokens }
      : {}),
  };
}
