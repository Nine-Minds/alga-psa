'use server';

import { getCurrentUser } from '../user-actions/userActions';
import { getConnection } from '@/lib/db/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from '@/lib/i18n/config';

/**
 * Get the user's company ID from their contact
 */
async function getUserCompanyId(userId: string, tenantId: string): Promise<string | null> {
  const knex = await getConnection(tenantId);

  // Get user's contact_id
  const user = await knex('users')
    .where({
      user_id: userId,
      tenant: tenantId
    })
    .first();

  if (!user?.contact_id) return null;

  // Get contact's company
  const contact = await knex('contacts')
    .where({
      contact_name_id: user.contact_id,
      tenant: tenantId
    })
    .first();

  return contact?.company_id || null;
}

/**
 * Get what locale would be inherited if the user had no personal preference
 * This checks company -> tenant -> system default
 */
export async function getInheritedLocaleAction(): Promise<{
  locale: SupportedLocale;
  source: 'company' | 'tenant' | 'system';
}> {
  const user = await getCurrentUser();

  if (!user) {
    return {
      locale: LOCALE_CONFIG.defaultLocale as SupportedLocale,
      source: 'system'
    };
  }

  const knex = await getConnection(user.tenant);

  // 1. Check company preference
  let companyId: string | null = null;

  // For client users, get their company
  if (user.user_type === 'client') {
    companyId = await getUserCompanyId(user.user_id, user.tenant);
  }

  if (companyId) {
    const company = await knex('companies')
      .where({
        company_id: companyId,
        tenant: user.tenant
      })
      .first();

    const companyLocale = company?.properties?.defaultLocale;
    if (companyLocale && isSupportedLocale(companyLocale)) {
      return {
        locale: companyLocale,
        source: 'company'
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