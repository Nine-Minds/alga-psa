"use server";

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser, getUserCompanyId } from 'server/src/lib/actions/user-actions/userActions';
import Company from 'server/src/lib/models/company';
import { getCompanyLogoUrl } from 'server/src/lib/utils/avatarUtils';
import type { ICompany } from 'server/src/interfaces/company.interfaces';

/**
 * Get the current client user's company without RBAC checks intended for MSP screens.
 * This action is specifically for client portal internal use.
 */
export async function getClientCompany(): Promise<ICompany | null> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const companyId = await getUserCompanyId(user.user_id);
  if (!companyId) {
    return null; // No associated company
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Company.getById enforces tenant scoping internally (WHERE tenant = currentTenant)
  // which is required for Citus/pooled connections to avoid cross-shard scans.
  const company = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await Company.getById(trx, companyId);
  });

  if (!company) return null;

  // Optionally include the logo URL for richer UI
  const logoUrl = await getCompanyLogoUrl(companyId, tenant);

  return { ...company, logoUrl } as ICompany;
}
