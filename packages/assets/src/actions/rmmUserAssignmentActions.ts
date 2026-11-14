'use server';

import type { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import {
  RmmUserMappingAuthorizationError,
  mapSignedInUserToContact,
  suggestContactForAsset,
  type RmmUserMappingAuthorizationRequest,
  type RmmSignedInUserSuggestion,
} from '@alga-psa/shared/rmm/signedInUserMappings';
import {
  permissionError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { assetActionErrorFrom, type AssetActionError } from './assetActionErrors';
import { createAssetReadContext, isAssetActionAllowed, isAssetOperationClosedForUser, isAssetReadAllowed } from '../lib/assetReadAuthorization';

type MappingActionUser = {
  user_id: string;
  user_type: 'internal' | 'client' | 'service';
  clientId?: string | null;
  roles?: Array<{ role_id?: string } | string>;
};

function createRmmMappingAuthorizer(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: MappingActionUser,
  action: 'read' | 'update',
) {
  // LEVERAGE: pattern rmm-action-record-authorization — the settings action builds the same policy bridge.
  let authorizationContextPromise: ReturnType<typeof createAssetReadContext> | undefined;
  return async ({ assetIds, contactId, integrationId }: RmmUserMappingAuthorizationRequest) => {
    const db = tenantDb(conn, tenant);
    const [integration, assetRows, contact] = await Promise.all([
      db.table('rmm_integrations')
        .where({ integration_id: integrationId })
        .first<{ integration_id: string }>('integration_id'),
      assetIds.length > 0
        ? db.table('assets')
            .whereIn('asset_id', assetIds)
            .select<Array<{ asset_id: string; client_id: string | null }>>('asset_id', 'client_id')
        : Promise.resolve([] as Array<{ asset_id: string; client_id: string | null }>),
      contactId
        ? db.table('contacts')
            .where({ contact_name_id: contactId })
            .whereNot({ contact_kind: 'shared_mailbox' })
            .first<{ contact_name_id: string; client_id: string | null }>('contact_name_id', 'client_id')
        : Promise.resolve(undefined),
    ]);

    if (!integration || assetRows.length !== new Set(assetIds).size ||
      (contactId && (!contact?.contact_name_id || !contact.client_id))) throw new RmmUserMappingAuthorizationError();
    if (contactId && !await hasPermission(user as any, 'contact', 'read', conn as Knex)) throw new RmmUserMappingAuthorizationError();

    const authorizationContext = await (authorizationContextPromise ??= createAssetReadContext(conn, tenant, user));
    const allowedAssets = await Promise.all(assetRows.map(async (asset) => {
      const readAllowed = await isAssetReadAllowed(conn, tenant, authorizationContext, asset);
      const actionAllowed = action === 'read'
        ? true
        : await isAssetActionAllowed(conn, tenant, authorizationContext, asset, action);
      return readAllowed && actionAllowed;
    }));
    if (allowedAssets.some((allowed) => !allowed)) throw new RmmUserMappingAuthorizationError();

    if (contactId && contact) {
      const contactDecision = await authorizationContext.authorizationKernel.authorizeResource({
        subject: authorizationContext.subject,
        resource: { type: 'contact', action: 'read', id: contactId },
        record: { id: contactId, clientId: contact.client_id },
        requestCache: authorizationContext.requestCache,
        knex: conn as Knex,
      });
      if (!contactDecision.allowed) throw new RmmUserMappingAuthorizationError();
    }

    // Integrations can span several client organizations. Evaluate the RMM
    // integration in each client scope the operation can affect so a selected-
    // client caller cannot use a shared integration as a cross-client handle.
    const clientIds = new Set<string>();
    for (const asset of assetRows) if (asset.client_id) clientIds.add(asset.client_id);
    if (contact?.client_id) clientIds.add(contact.client_id);
    if (clientIds.size === 0) {
      const organizations = await db.table('rmm_organization_mappings')
        .where({ integration_id: integrationId })
        .select<Array<{ client_id: string | null }>>('client_id');
      for (const organization of organizations) if (organization.client_id) clientIds.add(organization.client_id);
    }
    const integrationScopes = clientIds.size > 0 ? [...clientIds] : [null];
    for (const clientId of integrationScopes) {
      const decision = await authorizationContext.authorizationKernel.authorizeResource({
        subject: authorizationContext.subject,
        resource: { type: 'rmm_integration', action, id: integrationId },
        record: { id: integrationId, clientId },
        requestCache: authorizationContext.requestCache,
        knex: conn as Knex,
      });
      if (!decision.allowed) throw new RmmUserMappingAuthorizationError();
    }
  };
}

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
  if (!await hasPermission(user, 'system_settings', 'read')) {
    return permissionError('Permission denied: Cannot read RMM integrations', 'msp/integrations:errors.rmm.permissions.read');
  }

  const { knex } = await createTenantKnex();
  if (await isAssetOperationClosedForUser(knex, tenant, user as MappingActionUser, 'rmm_mapping')) {
    return permissionError('Permission denied: Cannot read RMM integrations', 'msp/integrations:errors.rmm.permissions.read');
  }
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const authorize = createRmmMappingAuthorizer(trx, tenant, user as MappingActionUser, 'read');
      return suggestContactForAsset(trx, tenant, assetId, authorize);
    });
  } catch (error) {
    const expected = assetActionErrorFrom(error);
    if (expected) return expected as ActionPermissionError;
    throw error;
  }
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
): Promise<{ key: string; assignedAssetIds: string[] } | AssetActionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }
  if (!await hasPermission(user, 'system_settings', 'update')) {
    return permissionError('Permission denied: Cannot update RMM integrations', 'msp/integrations:errors.rmm.permissions.update');
  }

  const { knex } = await createTenantKnex();
  if (await isAssetOperationClosedForUser(knex, tenant, user as MappingActionUser, 'rmm_mapping')) {
    return permissionError('Permission denied: Cannot update RMM integrations', 'msp/integrations:errors.rmm.permissions.update');
  }
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const authorize = createRmmMappingAuthorizer(trx, tenant, user as MappingActionUser, 'update');
      return mapSignedInUserToContact(trx, tenant, { ...input, actorUserId: user.user_id, authorize });
    });
  } catch (error) {
    // A rejected assignment (workspace member, contact of another client)
    // rolls the mapping back too — the dialog has to say so instead of
    // sitting open as if nothing happened.
    const expected = assetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
