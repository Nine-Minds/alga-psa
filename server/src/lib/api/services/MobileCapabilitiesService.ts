import { createHash } from 'node:crypto';
import { hasApiContextPermission } from '../middleware/apiContextPermission';
import {
  BaseService,
  type ServiceContext,
} from '@alga-psa/db';
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
import { readDontNotifyCustomerDefault } from '@alga-psa/notifications/notifications/notificationPolicy';
import { resolveAuthorizationSubject } from '@alga-psa/authorization/subject';
import { coManagedSeatAuthority } from '@alga-psa/co-managed/seatAuthority';
import { tenantDb } from '@alga-psa/db';
import { CO_MANAGED_SEAT_SURFACE } from '@shared/services/productSurfaceKinds';
import { loadProductPrincipal } from '@shared/services/productPrincipal';

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
    /** Project tasks on mobile; PSA only, like the Projects module itself. */
    projects: boolean;
    /** Asset browsing on mobile; PSA only. */
    assets: boolean;
    /** Site audits; needs asset read AND write, so a read-only tech cannot start one. */
    assetAudit: boolean;
    /** Client/contact writes follow RBAC alone: both products have clients and contacts. */
    clientsCreate: boolean;
    clientsUpdate: boolean;
    contactsCreate: boolean;
    contactsUpdate: boolean;
    /**
     * Tenant setting: every "Don't notify the customer" checkbox starts ticked.
     * Mirrors `notification_settings.default_dont_notify_customer` (Settings ->
     * Notifications -> Email -> Settings on the web).
     */
    dontNotifyCustomerDefault: boolean;
    /**
     * The session reaches the operational surface only (a co-managed seat technician): tickets, projects,
     * assets, contacts and their own time. The server refuses everything else for the session's key.
     */
    operationalOnly: boolean;
  };
  /** Set when `operationalOnly`: the one client the session works for and the boards it may open tickets on. */
  operationalScope?: MobileOperationalScope | null;
  /**
   * How this user's dates are written, resolved from their country exactly as
   * the web layouts resolve it. The device locale must not decide this: a
   * technician with a UK phone working for a US MSP reads the MSP's dates.
   */
  formatting: CountryDateFormat;
  theme: MobileTheme;
}

export interface MobileOperationalScope {
  client: { clientId: string; clientName: string } | null;
  creatableBoardIds: string[];
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

  private async getDontNotifyCustomerDefault(
    knex: Parameters<typeof readDontNotifyCustomerDefault>[0],
    tenant: string,
  ): Promise<boolean> {
    try {
      return await readDontNotifyCustomerDefault(knex, tenant);
    } catch {
      // Fail open: the historical behavior is unticked checkboxes.
      return false;
    }
  }
  /** The seat technician's live scope, for the pickers the app cannot fill from closed endpoints. */
  private async resolveOperationalScope(
    knex: Awaited<ReturnType<MobileCapabilitiesService['getDbForContext']>>,
    context: ServiceContext,
  ): Promise<MobileOperationalScope> {
    const subject = await resolveAuthorizationSubject(knex, {
      tenant: context.tenant,
      user: context.user ?? { user_id: context.userId },
      apiKeyId: context.apiKeyId,
    });
    const scope = coManagedSeatAuthority(subject)?.scope;
    if (!scope) return { client: null, creatableBoardIds: [] };
    const client = await tenantDb(knex, context.tenant).table('clients')
      .where({ client_id: scope.clientId })
      .first('client_name');
    return {
      client: client ? { clientId: scope.clientId, clientName: client.client_name } : null,
      creatableBoardIds: scope.creatableBoardIds,
    };
  }

  async getMyCapabilities(context: ServiceContext): Promise<MobileFeatureCapabilities> {
    const formatting = await this.getFormatting(context);
    const theme = await this.resolveTheme(context.tenant);
    const productCode = await getTenantProduct(context.tenant);
    const knex = await this.getDbForContext(context);
    const dontNotifyCustomerDefault = await this.getDontNotifyCustomerDefault(knex, context.tenant);

    const { surfaceKind } = await loadProductPrincipal({ tenantId: context.tenant, userId: context.userId });
    if (surfaceKind === CO_MANAGED_SEAT_SURFACE) {
      const [projects, assets] = productCode === 'psa'
        ? await Promise.all([
            hasApiContextPermission(context, 'project', 'read', knex),
            hasApiContextPermission(context, 'asset', 'read', knex),
          ])
        : [false, false];
      return {
        features: {
          inventory: false,
          opportunities: false,
          opportunitiesCreate: false,
          projects,
          assets,
          assetAudit: false,
          clientsCreate: false,
          clientsUpdate: false,
          contactsCreate: false,
          contactsUpdate: false,
          dontNotifyCustomerDefault,
          operationalOnly: true,
        },
        operationalScope: await this.resolveOperationalScope(knex, context),
        formatting,
        theme,
      };
    }

    const [clientsCreate, clientsUpdate, contactsCreate, contactsUpdate] = await Promise.all([
      hasApiContextPermission(context, 'client', 'create', knex),
      hasApiContextPermission(context, 'client', 'update', knex),
      hasApiContextPermission(context, 'contact', 'create', knex),
      hasApiContextPermission(context, 'contact', 'update', knex),
    ]);
    const crm = { clientsCreate, clientsUpdate, contactsCreate, contactsUpdate, operationalOnly: false };

    if (productCode !== 'psa') {
      return {
        features: {
          inventory: false,
          opportunities: false,
          opportunitiesCreate: false,
          projects: false,
          assets: false,
          assetAudit: false,
          dontNotifyCustomerDefault,
          ...crm,
        },
        formatting,
        theme,
      };
    }

    const [inventory, opportunities, opportunitiesCreate, projects, assets, assetsUpdate] = await Promise.all([
      hasApiContextPermission(context, 'inventory', 'read', knex),
      hasApiContextPermission(context, 'opportunities', 'read', knex),
      hasApiContextPermission(context, 'opportunities', 'create', knex),
      hasApiContextPermission(context, 'project', 'read', knex),
      hasApiContextPermission(context, 'asset', 'read', knex),
      hasApiContextPermission(context, 'asset', 'update', knex),
    ]);

    return {
      features: {
        inventory,
        opportunities,
        opportunitiesCreate,
        projects,
        assets,
        assetAudit: assets && assetsUpdate,
        dontNotifyCustomerDefault,
        ...crm,
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
