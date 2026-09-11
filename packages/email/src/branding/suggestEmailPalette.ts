import { CUSTOM_THEME_PRESETS } from '@alga-psa/tenancy/lib/customTheme';
import { DEFAULT_THEME_PAIR_ID } from '@alga-psa/tenancy/lib/themePairs';
import { normalizeTenantTheme } from '@alga-psa/tenancy/lib/tenantTheme';
import { isHexColor, normalizeHex } from './color';
import { STOCK_EMAIL_PALETTE } from './stockPalette';
import type { EmailBrandingSuggestion } from './types';

export interface SuggestEmailPaletteInput {
  /** `tenant_settings.settings.theme`. */
  theme?: unknown;
  /** `tenant_settings.settings.branding`. */
  branding?: { primaryColor?: string | null; secondaryColor?: string | null } | null;
}

const pick = (primary: string, secondary: string, source: EmailBrandingSuggestion['source']): EmailBrandingSuggestion => ({
  primary: normalizeHex(primary) ?? primary,
  secondary: normalizeHex(secondary) ?? secondary,
  source,
});

/**
 * Suggests the colors a tenant has already chosen somewhere else, so branding
 * every email is usually "confirm and apply": their custom theme first, then
 * the theme pair they picked (the stock `alga` pair does not count as a
 * choice), then client portal branding, then the AlgaPSA palette.
 */
export function suggestEmailPalette(input: SuggestEmailPaletteInput): EmailBrandingSuggestion {
  const theme = normalizeTenantTheme(input.theme);

  const customLight = theme.customTheme?.light;
  if (theme.pairId === 'custom' && isHexColor(customLight?.primary) && isHexColor(customLight?.secondary)) {
    return pick(customLight!.primary, customLight!.secondary, 'custom-theme');
  }

  if (theme.pairId !== DEFAULT_THEME_PAIR_ID && theme.pairId !== 'custom') {
    const preset = CUSTOM_THEME_PRESETS[theme.pairId]?.light;
    if (isHexColor(preset?.primary) && isHexColor(preset?.secondary)) {
      return pick(preset!.primary, preset!.secondary, 'theme-pair');
    }
  }

  const branding = input.branding;
  if (isHexColor(branding?.primaryColor)) {
    const secondary = isHexColor(branding?.secondaryColor)
      ? branding!.secondaryColor!
      : STOCK_EMAIL_PALETTE.secondary;
    return pick(branding!.primaryColor!, secondary, 'portal-branding');
  }

  return pick(STOCK_EMAIL_PALETTE.primary, STOCK_EMAIL_PALETTE.secondary, 'default');
}
