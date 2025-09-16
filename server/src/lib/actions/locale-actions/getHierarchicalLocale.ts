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
      contact_id: user.contact_id,
      tenant: tenantId
    })
    .first();

  return contact?.company_id || null;
}

/**
 * Get the proper locale for the current user based on the hierarchy:
 * 1. User preference
 * 2. Company preference
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

  // 2. Check company preference
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
      return companyLocale;
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