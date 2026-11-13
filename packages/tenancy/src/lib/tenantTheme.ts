import { DEFAULT_THEME_PAIR_ID, isThemePairId, type ThemePairId } from './themePairs';
import {
  CUSTOM_THEME_TOKEN_KEYS,
  generateCustomThemeStyles,
  type CustomTheme,
  type CustomThemeTokens,
} from './customTheme';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function projectCustomThemeTokens(value: unknown): CustomThemeTokens | null {
  if (!isRecord(value)) return null;

  const tokens: Partial<CustomThemeTokens> = {};
  for (const key of CUSTOM_THEME_TOKEN_KEYS) {
    const token = value[key];
    if (typeof token !== 'string' || !/^#[0-9a-f]{6}$/i.test(token)) return null;
    tokens[key] = token;
  }

  return tokens as CustomThemeTokens;
}

/** Projects stored custom themes to the renderer's supported fields and tokens. */
function projectCustomTheme(value: unknown): CustomTheme | undefined {
  if (!isRecord(value)) return undefined;

  const light = projectCustomThemeTokens(value.light);
  const dark = projectCustomThemeTokens(value.dark);
  if (!light || !dark) return undefined;

  return {
    light,
    dark,
    // Never trust cached CSS from JSONB. Rebuild it from validated tokens.
    ...(typeof value.computedStyles === 'string'
      ? { computedStyles: generateCustomThemeStyles({ light, dark }) }
      : {}),
  };
}

/** Normalizes whatever is in the JSONB blob into a theme the renderer can trust. */
export function normalizeTenantTheme(raw: unknown): TenantTheme {
  const value = isRecord(raw) ? raw : {};
  const requested = isThemePairId(value.pairId) ? value.pairId : DEFAULT_THEME_PAIR_ID;
  const customTheme = projectCustomTheme(value.customTheme);

  // A tenant can only sit on "custom" while a custom theme actually exists.
  const pairId = requested === 'custom' && !customTheme ? DEFAULT_THEME_PAIR_ID : requested;

  return {
    pairId,
    ...(customTheme ? { customTheme } : {}),
    ...(value.mspWhiteLabel === true ? { mspWhiteLabel: true } : {}),
  };
}
