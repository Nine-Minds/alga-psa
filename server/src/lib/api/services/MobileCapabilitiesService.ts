import { createHash } from 'node:crypto';
import {
  BaseService,
  type ServiceContext,
} from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { resolveDateFormatCountry } from '@alga-psa/tenancy/lib/tenantDefaultCountry';
import {
  countryDateFormat,
  SYSTEM_DATE_FORMAT,
  type CountryDateFormat,
} from '@alga-psa/core/i18n/countryDateFormat';
import { getTenantProduct } from '@/lib/productAccess';
import { getTenantThemeByTenantId } from '@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions';
import {
  CUSTOM_THEME_PRESETS,
  CUSTOM_THEME_TOKEN_KEYS,
  findInvalidCustomThemeTokens,
  type CustomThemeTokens,
} from '@alga-psa/tenancy/lib/customTheme';
import {
  DEFAULT_THEME_PAIR_ID,
  getThemePairMeta,
  type ThemePairId,
} from '@alga-psa/tenancy/lib/themePairs';

/** The 15 seed tokens the mobile app derives its whole palette from. */
export type MobileThemeSeedTokens = CustomThemeTokens;

export interface MobileTheme {
  pairId: ThemePairId;
  /** English pair name; 'Custom' for a tenant-authored pair. */
  label: string;
  light: MobileThemeSeedTokens;
  dark: MobileThemeSeedTokens;
  /** Stable hash of pairId + both token sets, so the app can skip unchanged pairs. */
  version: string;
}

export interface MobileFeatureCapabilities {
  features: {
    inventory: boolean;
    opportunities: boolean;
    opportunitiesCreate: boolean;
  };
  /**
   * How this user's dates are written, resolved from their country exactly as
   * the web layouts resolve it. The device locale must not decide this: a
   * technician with a UK phone working for a US MSP reads the MSP's dates.
   */
  formatting: CountryDateFormat;
  theme: MobileTheme;
}

const ALGA_PRESET = CUSTOM_THEME_PRESETS[DEFAULT_THEME_PAIR_ID as 'alga'];

/** Key order is fixed so a re-saved-but-unchanged palette keeps its version. */
function canonicalTokens(tokens: Partial<CustomThemeTokens>): CustomThemeTokens {
  return CUSTOM_THEME_TOKEN_KEYS.reduce((acc, key) => {
    acc[key] = tokens[key] ?? '';
    return acc;
  }, {} as CustomThemeTokens);
}

function themeVersion(pairId: ThemePairId, light: CustomThemeTokens, dark: CustomThemeTokens): string {
  return createHash('sha256')
    .update(JSON.stringify({ pairId, light, dark }))
    .digest('hex')
    .slice(0, 16);
}

function buildMobileTheme(
  pairId: ThemePairId,
  tokens: { light: CustomThemeTokens; dark: CustomThemeTokens },
): MobileTheme {
  const light = canonicalTokens(tokens.light);
  const dark = canonicalTokens(tokens.dark);
  return {
    pairId,
    label: pairId === 'custom' ? 'Custom' : getThemePairMeta(pairId)?.label ?? 'Alga',
    light,
    dark,
    version: themeVersion(pairId, light, dark),
  };
}

function defaultMobileTheme(): MobileTheme {
  return buildMobileTheme(DEFAULT_THEME_PAIR_ID, ALGA_PRESET);
}

export class MobileCapabilitiesService extends BaseService<never> {
  constructor() {
    super({
      tableName: 'users',
      primaryKey: 'user_id',
      tenantColumn: 'tenant',
    });
  }

  private async getFormatting(context: ServiceContext): Promise<CountryDateFormat> {
    try {
      const knex = await this.getDbForContext(context);
      const country = await resolveDateFormatCountry(knex, context.tenant, context.user);
      return countryDateFormat(country?.code ?? null);
    } catch {
      return SYSTEM_DATE_FORMAT;
    }
  }

  async getMyCapabilities(context: ServiceContext): Promise<MobileFeatureCapabilities> {
    const formatting = await this.getFormatting(context);
    const theme = await this.resolveTheme(context.tenant);
    const productCode = await getTenantProduct(context.tenant);
    if (productCode !== 'psa') {
      return {
        features: {
          inventory: false,
          opportunities: false,
          opportunitiesCreate: false,
        },
        formatting,
        theme,
      };
    }

    const knex = await this.getDbForContext(context);
    const [inventory, opportunities, opportunitiesCreate] = await Promise.all([
      hasPermission(context.user, 'inventory', 'read', knex),
      hasPermission(context.user, 'opportunities', 'read', knex),
      hasPermission(context.user, 'opportunities', 'create', knex),
    ]);

    return {
      features: {
        inventory,
        opportunities,
        opportunitiesCreate,
      },
      formatting,
      theme,
    };
  }

  /**
   * The pair the tenant chose, as seed tokens. Anything unreadable — a missing
   * theme, an unknown pair, a half-written custom palette — falls back to Alga
   * rather than failing the capabilities call the whole app boots through.
   */
  private async resolveTheme(tenant: string): Promise<MobileTheme> {
    try {
      const tenantTheme = await getTenantThemeByTenantId(tenant);

      if (tenantTheme.pairId === 'custom') {
        const custom = tenantTheme.customTheme;
        const invalid = custom
          ? [
              ...findInvalidCustomThemeTokens(custom.light ?? {}),
              ...findInvalidCustomThemeTokens(custom.dark ?? {}),
            ]
          : ['missing'];
        if (custom && invalid.length === 0) {
          return buildMobileTheme('custom', { light: custom.light, dark: custom.dark });
        }
        return defaultMobileTheme();
      }

      const preset = CUSTOM_THEME_PRESETS[tenantTheme.pairId as Exclude<ThemePairId, 'custom'>];
      if (!preset) {
        return defaultMobileTheme();
      }
      return buildMobileTheme(tenantTheme.pairId, preset);
    } catch {
      return defaultMobileTheme();
    }
  }
}
