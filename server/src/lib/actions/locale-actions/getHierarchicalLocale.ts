'use server';

import { getCurrentUser } from '../user-actions/userActions';
import { getConnection } from '@/lib/db/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from '@alga-psa/ui/lib/i18n/config';

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
 * 2. Client preference
 * 3. Tenant preference
 * 4. System default
 */
export async function getHierarchicalLocaleAction(): Promise<SupportedLocale> {
  const user = await getCurrentUser();

  if (!user) {
    return LOCALE_CONFIG.defaultLocale as SupportedLocale;
  }

  const knex = await getConnection(user.tenant);

  // 1. Check user preference
  const userPref = await knex('user_preferences')
    .where({
      user_id: user.user_id,
      setting_name: 'locale',
      tenant: user.tenant
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

  // 2. Check client preference
  let clientId: string | null = null;

  // For client users, get their client
  if (user.user_type === 'client') {
    clientId = await getUserClientId(user.user_id, user.tenant);
  }

  if (clientId) {
    const client = await knex('clients')
      .where({
        client_id: clientId,
        tenant: user.tenant
      })
      .first();

    const clientLocale = client?.properties?.defaultLocale;
    if (clientLocale && isSupportedLocale(clientLocale)) {
      return clientLocale;
    }
  }

  // 3. Check tenant preference
  const tenantSettings = await knex('tenant_settings')
    .where({ tenant: user.tenant })
    .first();

  // Check client portal default first (for client users)
  if (user.user_type === 'client') {
    const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
    if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
      return clientPortalLocale;
    }
  }

  // Check tenant-wide default
  const tenantDefaultLocale = tenantSettings?.settings?.defaultLocale;
  if (tenantDefaultLocale && isSupportedLocale(tenantDefaultLocale)) {
    return tenantDefaultLocale;
  }

  // 4. System default
  return LOCALE_CONFIG.defaultLocale as SupportedLocale;
}