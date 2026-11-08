export * from '@alga-psa/authorization/assetReadAuthorization';

import { hasPermission } from '@alga-psa/auth/rbac';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  createAssetReadContextWithRules,
  isAssetActionAllowed,
  resolveAuthorizationSubjectForUser,
  type AssetAuthUser,
  type AssetAuthorizationAction,
} from '@alga-psa/authorization/assetReadAuthorization';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';

/**
 * Require both the coarse asset permission and the kernel's per-verb policy
 * decision before a caller touches an asset or data owned by it. Resolve the
 * asset in the same transaction so authorization and note access share a view.
 */
export async function assertAssetAccess(
  trx: Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  assetId: string,
  action: AssetAuthorizationAction
): Promise<{ asset_id: string; client_id: string | null }> {
  const asset = await tenantDb(trx, tenant).table('assets')
    .where({ asset_id: assetId })
    .select('asset_id', 'client_id')
    .first() as { asset_id: string; client_id: string | null } | undefined;

  // Keep missing and inaccessible ids indistinguishable to callers.
  if (!asset || !await hasPermission(user as any, 'asset', action, trx)) {
    throw new Error('Asset not found');
  }

  const subject = await resolveAuthorizationSubjectForUser(trx, tenant, user);
  let rules: Awaited<ReturnType<typeof resolveBundleNarrowingRulesForEvaluation>>;
  try {
    rules = await resolveBundleNarrowingRulesForEvaluation(trx, {
      subject,
      resource: { type: 'asset', action, id: asset.asset_id },
      record: { id: asset.asset_id, clientId: asset.client_id, ownerUserId: null, assignedUserIds: [], teamIds: [] },
      knex: trx,
    });
  } catch {
    throw new Error('Asset not found');
  }
  // Bundle rules narrow RBAC grants. The kernel also enforces built-in client
  // scope when no bundle rule applies to this action.
  const context = await createAssetReadContextWithRules(trx, subject, rules);
  if (!await isAssetActionAllowed(trx, tenant, context, asset, action)) {
    throw new Error('Asset not found');
  }

  return asset;
}
