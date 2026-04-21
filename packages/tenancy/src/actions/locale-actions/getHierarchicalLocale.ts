'use server';

import { getConnection } from '@alga-psa/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from '@alga-psa/core/i18n/config';
import { withOptionalAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

/**
 * Get the user's client ID from their contact
 */
async function getUserClientId(userId: string, tenantId: string): Promise<string | null> {
  const knex = await getConnection(tenantId);

  // Get user's contact_id
  const user = await knex('users')
    .where({
      user_id: userId,
      tenant: tenantId
    })
    .first();

  if (!user?.contact_id) return null;

  // Get contact's client
  const contact = await knex('contacts')
    .where({
      contact_name_id: user.contact_id,
      tenant: tenantId
    })
    .first();

  return contact?.client_id || null;
}

/**
 * Get the proper locale for the current user based on the hierarchy:
 * 1. User preference
 * 2. Client-specific default (for client-portal users only — clients.properties.defaultLocale)
 * 3. Client-portal default (for client-portal users only — settings.clientPortal.defaultLocale)
 * 4. Organization default (settings.defaultLocale — applies to everyone)
 * 5. System default ('en')
 *
 * Internal (MSP staff) users skip steps 2 and 3 — they resolve directly to the
 * organization default. Legacy settings.mspPortal.defaultLocale (written by the
 * retired split UI) is consulted only if the org default is unset.
 */
export const getHierarchicalLocaleAction = withOptionalAuth(async (user: IUserWithRoles | null, ctx: AuthContext | null): Promise<SupportedLocale> => {
  if (!user || !ctx) {
    return LOCALE_CONFIG.defaultLocale as SupportedLocale;
  }

  const { tenant } = ctx;
  const knex = await getConnection(tenant);

  // 1. Check user preference
  const userPref = await knex('user_preferences')
    .where({
      user_id: user.user_id,
      setting_name: 'locale',
      tenant
    })
    .first();

  if (userPref?.setting_value) {
    const locale = typeof userPref.setting_value === 'string'
      ? userPref.setting_value.replace(/"/g, '')
      : userPref.setting_value;

    if (isSupportedLocale(locale)) {
      return locale;
    }
  }

  const tenantSettings = await knex('tenant_settings')
    .where({ tenant })
    .first();

  // 2–3. Client-portal users: client-specific default, then client-portal default
  if (user.user_type === 'client') {
    const clientId = await getUserClientId(user.user_id, tenant);
    if (clientId) {
      const client = await knex('clients')
        .where({ client_id: clientId, tenant })
        .first();

      const clientLocale = client?.properties?.defaultLocale;
      if (clientLocale && isSupportedLocale(clientLocale)) {
        return clientLocale;
      }
    }

    const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
    if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
      return clientPortalLocale;
    }
  }

  // 4. Organization default (applies to everyone)
  const tenantDefaultLocale = tenantSettings?.settings?.defaultLocale;
  if (tenantDefaultLocale && isSupportedLocale(tenantDefaultLocale)) {
    return tenantDefaultLocale;
  }

  // Legacy: MSP-portal-only default written by the retired split UI. Kept so
  // tenants that only ever set the MSP default keep resolving.
  if (user.user_type === 'internal') {
    const legacyMspLocale = tenantSettings?.settings?.mspPortal?.defaultLocale;
    if (legacyMspLocale && isSupportedLocale(legacyMspLocale)) {
      return legacyMspLocale;
    }
  }

  // 5. System default
  return LOCALE_CONFIG.defaultLocale as SupportedLocale;
});
