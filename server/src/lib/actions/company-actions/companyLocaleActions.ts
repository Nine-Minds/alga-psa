'use server';

import { getConnection } from '@/lib/db/db';
import { SupportedLocale, isSupportedLocale } from '@/lib/i18n/config';
import { getCurrentUser } from '../user-actions/userActions';

/**
 * Update company's default locale for all contacts
 */
export async function updateCompanyLocaleAction(
  companyId: string,
  locale: SupportedLocale
) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not found');
  }

  if (!isSupportedLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const knex = await getConnection(user.tenant);

  // Get existing company
  const company = await knex('companies')
    .where({
      company_id: companyId,
      tenant: user.tenant
    })
    .first();

  if (!company) {
    throw new Error('Company not found');
  }

  // Update properties JSONB with new locale
  const updatedProperties = {
    ...(company.properties || {}),
    defaultLocale: locale
  };

  await knex('companies')
    .where({
      company_id: companyId,
      tenant: user.tenant
    })
    .update({
      properties: updatedProperties,
      updated_at: knex.fn.now()
    });

  return { success: true };
}

/**
 * Get company's default locale
 */
export async function getCompanyLocaleAction(
  companyId: string
): Promise<SupportedLocale | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const knex = await getConnection(user.tenant);

  const company = await knex('companies')
    .where({
      company_id: companyId,
      tenant: user.tenant
    })
    .first();

  const locale = company?.properties?.defaultLocale;
  return isSupportedLocale(locale) ? locale : null;
}