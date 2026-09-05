'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';

import { fetchTenantParty, type TenantParty } from '../lib/adapters/tenantPartyAdapter';

/**
 * The tenant's own "Your Company" party for designer previews, resolved through the same adapter the
 * real quote / sales order / invoice renders use, so a preview matches the final document.
 * Returns null (rather than an error object) when branding is unavailable or the caller lacks billing
 * read, so preview surfaces fall back to their synthetic sample party instead of rendering blank.
 */
export const getTenantBrandingForDocumentPreview = withAuth(
  async (user, { tenant }): Promise<TenantParty | null> => {
    if (!(await hasPermission(user as any, 'billing', 'read'))) {
      return null;
    }
    const { knex } = await createTenantKnex();
    return fetchTenantParty(knex, tenant);
  },
);
