import { DEFAULT_THEME_PAIR_ID, isThemePairId, type ThemePairId } from './themePairs';
import type { CustomTheme } from './customTheme';

/** Shape of `tenant_settings.settings.theme` — sibling of the branding blob. */
export interface TenantTheme {
  pairId: ThemePairId;
  customTheme?: CustomTheme;
  /**
   * Enterprise white-label opt-in: puts the tenant's logo and brand colors on
   * the MSP shell too. Off by default so tenants that only ever configured
   * client-portal branding keep the stock MSP chrome they have today.
   */
  mspWhiteLabel?: boolean;
}

/** Absent settings.theme means the tenant is on the stock Alga pair. */
export const DEFAULT_TENANT_THEME: TenantTheme = { pairId: DEFAULT_THEME_PAIR_ID };

/** Normalizes whatever is in the JSONB blob into a theme the renderer can trust. */
export function normalizeTenantTheme(raw: unknown): TenantTheme {
  const value = (raw ?? {}) as Partial<TenantTheme>;
  const requested = isThemePairId(value.pairId) ? value.pairId : DEFAULT_THEME_PAIR_ID;
  const customTheme = value.customTheme;

  // A tenant can only sit on "custom" while a custom theme actually exists.
  const pairId = requested === 'custom' && !customTheme ? DEFAULT_THEME_PAIR_ID : requested;

  return {
    pairId,
    ...(customTheme ? { customTheme } : {}),
    ...(value.mspWhiteLabel ? { mspWhiteLabel: true } : {}),
  };
}
