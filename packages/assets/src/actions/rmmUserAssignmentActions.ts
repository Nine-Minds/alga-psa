'use server';

import type { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import {
  mapSignedInUserToContact,
  suggestContactForAsset,
  type RmmSignedInUserSuggestion,
} from '@alga-psa/shared/rmm/signedInUserMappings';
import {
  permissionError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

/**
 * FR-D5 / FR-D6 on the asset surfaces. The core lives in
 * `shared/rmm/signedInUserMappings.ts` so the RMM settings panel can wrap the
 * same functions without the assets and integrations packages importing each
 * other's barrels.
 */

export const suggestAssigneeFromRmmUser = withAuth(async (
  user,
  { tenant },
  assetId: string
): Promise<RmmSignedInUserSuggestion | null | ActionPermissionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }

  const { knex } = await createTenantKnex();
  return suggestContactForAsset(knex, tenant, assetId);
});

export const mapRmmUserToContact = withAuth(async (
  user,
  { tenant },
  input: {
    integrationId: string;
    provider: string;
    rawUser: string;
    contactId: string | null;
    assignAssetId?: string | null;
  }
): Promise<{ key: string; assignedAssetIds: string[] } | ActionPermissionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) =>
    mapSignedInUserToContact(trx, tenant, { ...input, actorUserId: user.user_id })
  );
});
