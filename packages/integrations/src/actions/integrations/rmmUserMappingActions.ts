'use server';

import type { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import {
  listSignedInUsersForOrganization,
  mapSignedInUserToContact,
  type RmmSignedInUserRow,
} from '@alga-psa/shared/rmm/signedInUserMappings';

/**
 * FR-D7 / FR-D6 for the RMM settings panel. The core lives in
 * `shared/rmm/signedInUserMappings.ts`, shared with the asset details page.
 */

export const listRmmSignedInUsers = withAuth(async (
  user,
  { tenant },
  input: { integrationId: string; externalOrganizationId: string }
): Promise<{ success: boolean; error?: string; users?: RmmSignedInUserRow[] }> => {
  if (!await hasPermission(user as any, 'system_settings', 'read')) {
    return { success: false, error: 'Forbidden' };
  }

  const { knex } = await createTenantKnex();
  const users = await listSignedInUsersForOrganization(knex, tenant, input);
  return { success: true, users };
});

export const mapRmmSignedInUserToContact = withAuth(async (
  user,
  { tenant },
  input: {
    integrationId: string;
    provider: string;
    rawUser: string;
    contactId: string | null;
    assignAssetId?: string | null;
  }
): Promise<{ success: boolean; error?: string; assignedCount?: number }> => {
  if (!await hasPermission(user as any, 'system_settings', 'update')) {
    return { success: false, error: 'Forbidden' };
  }

  try {
    const { knex } = await createTenantKnex();
    const result = await withTransaction(knex, async (trx: Knex.Transaction) =>
      mapSignedInUserToContact(trx, tenant, { ...input, actorUserId: (user as { user_id: string }).user_id })
    );
    return { success: true, assignedCount: result.assignedAssetIds.length };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unable to save the mapping.' };
  }
});
