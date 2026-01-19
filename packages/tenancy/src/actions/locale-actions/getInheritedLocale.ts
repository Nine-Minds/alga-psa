'use server';

import { getCurrentUser } from '@alga-psa/users/actions';
import { getConnection } from '@alga-psa/db';
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
 * Get what locale would be inherited if the user had no personal preference
 * This checks client -> tenant -> system default
 */
export async function getInheritedLocaleAction(): Promise<{
  locale: SupportedLocale;
  source: 'client' | 'tenant' | 'system';
}> {
  const user = await getCurrentUser();

  if (!user) {
    return {
      locale: LOCALE_CONFIG.defaultLocale as SupportedLocale,
      source: 'system'
    };
  }

  const knex = await getConnection(user.tenant);

  // 1. Check client preference
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
      return {
        locale: clientLocale,
        source: 'client'
      };
    }
  }

  // 2. Check tenant preference
  const tenantSettings = await knex('tenant_settings')
    .where({ tenant: user.tenant })
    .first();

  // Check client portal default first (for client users)
  if (user.user_type === 'client') {
    const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
    if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
      return {
        locale: clientPortalLocale,
        source: 'tenant'
      };
    }
  }

  // Check tenant-wide default
  const tenantDefaultLocale = tenantSettings?.settings?.defaultLocale;
  if (tenantDefaultLocale && isSupportedLocale(tenantDefaultLocale)) {
    return {
      locale: tenantDefaultLocale,
      source: 'tenant'
    };
  }

  // 3. System default
  return {
    locale: LOCALE_CONFIG.defaultLocale as SupportedLocale,
    source: 'system'
  };
}