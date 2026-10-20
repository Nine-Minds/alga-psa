'use server';

import type { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { tenantDb } from '@alga-psa/db';
import { countRmmOrganizationAssets as countOrganizationAssets } from '@alga-psa/shared/rmm/moveRmmOrganizationAssets';
import {
  listSignedInUsersForOrganization,
  mapSignedInUserToContact,
  type RmmSignedInUserRow,
} from '@alga-psa/shared/rmm/signedInUserMappings';

/**
 * The mapping row is what every settings UI has to hand; the integration id,
 * organization id and provider are derived here so none of the five managers
 * has to thread them through its own data loader.
 */
async function resolveMapping(
  knex: Parameters<typeof tenantDb>[0],
  tenant: string,
  mappingId: string
): Promise<{ integrationId: string; externalOrganizationId: string; provider: string } | null> {
  const db = tenantDb(knex, tenant);
  const mapping = await db.table('rmm_organization_mappings')
    .where({ mapping_id: mappingId })
    .first<{ integration_id: string; external_organization_id: string }>(
      'integration_id',
      'external_organization_id'
    );
  if (!mapping?.integration_id) return null;

  const integration = await db.table('rmm_integrations')
    .where({ integration_id: mapping.integration_id })
    .first<{ provider: string }>('provider');
  if (!integration?.provider) return null;

  return {
    integrationId: String(mapping.integration_id),
    externalOrganizationId: String(mapping.external_organization_id),
    provider: integration.provider,
  };
}

/**
 * FR-D7 / FR-D6 for the RMM settings panel. The core lives in
 * `shared/rmm/signedInUserMappings.ts`, shared with the asset details page.
 */

export const listRmmSignedInUsers = withAuth(async (
  user,
  { tenant },
  input: { mappingId: string }
): Promise<{ success: boolean; error?: string; users?: RmmSignedInUserRow[] }> => {
  if (!await hasPermission(user as any, 'system_settings', 'read')) {
    return { success: false, error: 'Forbidden' };
  }

  const { knex } = await createTenantKnex();
  const resolved = await resolveMapping(knex, tenant, input.mappingId);
  if (!resolved) return { success: false, error: 'Mapping not found' };

  const users = await listSignedInUsersForOrganization(knex, tenant, {
    integrationId: resolved.integrationId,
    externalOrganizationId: resolved.externalOrganizationId,
  });
  return { success: true, users };
});

export const mapRmmSignedInUserToContact = withAuth(async (
  user,
  { tenant },
  input: {
    mappingId: string;
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
    const resolved = await resolveMapping(knex, tenant, input.mappingId);
    if (!resolved) return { success: false, error: 'Mapping not found' };

    const result = await withTransaction(knex, async (trx: Knex.Transaction) =>
      mapSignedInUserToContact(trx, tenant, {
        integrationId: resolved.integrationId,
        provider: resolved.provider,
        rawUser: input.rawUser,
        contactId: input.contactId,
        assignAssetId: input.assignAssetId,
        actorUserId: (user as { user_id: string }).user_id,
      })
    );
    return { success: true, assignedCount: result.assignedAssetIds.length };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unable to save the mapping.' };
  }
});

/**
 * FR-G4: how many assets a client change on this organization will move. The
 * mapping UIs put the number in the confirmation, because clearing assignees,
 * groups and billing profiles on 37 devices is not something to do blind.
 */
export const countRmmOrganizationAssets = withAuth(async (
  user,
  { tenant },
  input: { mappingId: string }
): Promise<{ success: boolean; error?: string; count?: number }> => {
  if (!await hasPermission(user as any, 'system_settings', 'read')) {
    return { success: false, error: 'Forbidden' };
  }

  const { knex } = await createTenantKnex();
  const resolved = await resolveMapping(knex, tenant, input.mappingId);
  if (!resolved) return { success: false, error: 'Mapping not found' };

  const count = await countOrganizationAssets(knex, tenant, {
    provider: resolved.provider,
    externalOrganizationId: resolved.externalOrganizationId,
  });
  return { success: true, count };
});

/**
 * F090: the mapped client's active billing profiles, for the per-organization
 * Billing profile select. The select hides itself when there are fewer than
 * two, so a single-profile client is never asked a question with one answer.
 */
export const listRmmOrganizationBillingProfiles = withAuth(async (
  user,
  { tenant },
  input: { clientId: string }
): Promise<{ success: boolean; error?: string; profiles?: Array<{ billing_profile_id: string; name: string }> }> => {
  if (!await hasPermission(user as any, 'system_settings', 'read')) {
    return { success: false, error: 'Forbidden' };
  }
  if (!input.clientId) return { success: true, profiles: [] };

  const { knex } = await createTenantKnex();
  const profiles = await withTransaction(knex, async (trx: Knex.Transaction) =>
    tenantDb(trx, tenant).table('client_billing_profiles')
      .where({ client_id: input.clientId, is_active: true })
      .orderBy('is_default', 'desc')
      .orderBy('name', 'asc')
      .select<Array<{ billing_profile_id: string; name: string }>>('billing_profile_id', 'name')
  );

  return { success: true, profiles };
});
