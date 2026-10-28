import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from './kernel';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';

/**
 * Asset read authorization, shared by the asset server actions and the label code paths.
 *
 * This is deliberately NOT a 'use server' module: `assetActions.ts` can only export server actions, so
 * the subject / record resolution lived there as private helpers and was copied into the label
 * provider. Both now delegate here. Read-only; nothing here writes.
 */

// LEVERAGE: pattern asset-read-authorization-wrappers — assetActions, the label seam, the custody services and the
// REST guard each still wrap subject/record resolution + authorizeResource; one "readable assets" layer would absorb them.
export type AssetAuthUser = {
  user_id: string;
  user_type: AuthorizationSubject['userType'];
  clientId?: string | null;
  roles?: Array<{ role_id?: string } | string>;
};

export type AssetAuthorizationInput = { asset_id: string; client_id?: string | null };

export type AssetReadAuthorizationContext = {
  subject: AuthorizationSubject;
  authorizationKernel: ReturnType<typeof createAuthorizationKernel>;
  requestCache: RequestLocalAuthorizationCache;
};

function extractRoleIdsFromUser(user: AssetAuthUser): string[] {
  if (!Array.isArray(user.roles)) {
    return [];
  }
  return user.roles
    .map((role) => {
      if (typeof role === 'string') {
        return role;
      }
      return typeof role?.role_id === 'string' ? role.role_id : null;
    })
    .filter((value): value is string => Boolean(value));
}

export async function resolveAuthorizationSubjectForUser(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser
): Promise<AuthorizationSubject> {
  const db = tenantDb(trx, tenant);
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    try {
      const roleRows = await db.table('user_roles').where({ user_id: user.user_id }).select<{ role_id: string }[]>('role_id');
      roleIds = roleRows.map((row) => row.role_id);
    } catch {
      roleIds = [];
    }
  }

  const [teamRows, managedRows] = await Promise.all([
    db.table('team_members').where({ user_id: user.user_id }).select<{ team_id: string }[]>('team_id').catch(() => []),
    db.table('users').where({ reports_to: user.user_id }).select<{ user_id: string }[]>('user_id').catch(() => []),
  ]);

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: user.clientId ? [user.clientId] : [],
  };
}

export async function resolveAssetAuthorizationRecords(
  trx: Knex | Knex.Transaction,
  tenant: string,
  assets: AssetAuthorizationInput[]
): Promise<Map<string, AuthorizationRecord>> {
  const assetIds = assets.map((asset) => asset.asset_id);
  if (assetIds.length === 0) {
    return new Map();
  }

  const associationRows = await tenantDb(trx, tenant)
    .table('asset_associations')
    .whereIn('asset_id', assetIds)
    .select<Array<{ asset_id: string; entity_type: string; entity_id: string }>>('asset_id', 'entity_type', 'entity_id');

  const associationsByAsset = new Map<string, Array<{ entity_type: string; entity_id: string }>>();
  for (const row of associationRows) {
    const existing = associationsByAsset.get(row.asset_id) ?? [];
    existing.push({ entity_type: row.entity_type, entity_id: row.entity_id });
    associationsByAsset.set(row.asset_id, existing);
  }

  const records = new Map<string, AuthorizationRecord>();
  for (const asset of assets) {
    const associations = associationsByAsset.get(asset.asset_id) ?? [];
    const assignedUserIds = associations.filter((a) => a.entity_type === 'user').map((a) => a.entity_id);
    const teamIds = associations.filter((a) => a.entity_type === 'team').map((a) => a.entity_id);
    records.set(asset.asset_id, {
      id: asset.asset_id,
      ownerUserId: assignedUserIds[0] ?? null,
      assignedUserIds,
      clientId: asset.client_id ?? null,
      teamIds,
    });
  }
  return records;
}

export function createAssetReadKernel(trx: Knex | Knex.Transaction) {
  return createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try {
          return await resolveBundleNarrowingRulesForEvaluation(trx as Knex.Transaction, input);
        } catch {
          return [];
        }
      },
    }),
    rbacEvaluator: async () => true,
  });
}

export async function createAssetReadContext(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser
): Promise<AssetReadAuthorizationContext> {
  return {
    subject: await resolveAuthorizationSubjectForUser(trx, tenant, user),
    authorizationKernel: createAssetReadKernel(trx),
    requestCache: new RequestLocalAuthorizationCache(),
  };
}

/** True when the caller's per-record kernel decision allows reading the asset. */
export async function isAssetReadAllowed(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  asset: AssetAuthorizationInput
): Promise<boolean> {
  const records = await resolveAssetAuthorizationRecords(trx, tenant, [asset]);
  const decision = await context.authorizationKernel.authorizeResource({
    subject: context.subject,
    resource: { type: 'asset', action: 'read', id: asset.asset_id },
    record: records.get(asset.asset_id),
    requestCache: context.requestCache,
    knex: trx as Knex,
  });
  return decision.allowed;
}

/**
 * Batch form of {@link isAssetReadAllowed}: the subset of `assets` the caller may read, resolved with ONE
 * association query. Used by the custody queue and label enrichment, where an unreadable asset must be
 * dropped, never leaked.
 */
export async function filterReadableAssets<T extends AssetAuthorizationInput>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  assets: readonly T[]
): Promise<T[]> {
  if (assets.length === 0) return [];
  const records = await resolveAssetAuthorizationRecords(trx, tenant, [...assets]);
  const allowed = await Promise.all(
    assets.map(async (asset) => {
      const decision = await context.authorizationKernel.authorizeResource({
        subject: context.subject,
        resource: { type: 'asset', action: 'read', id: asset.asset_id },
        record: records.get(asset.asset_id),
        requestCache: context.requestCache,
        knex: trx as Knex,
      });
      return decision.allowed;
    })
  );
  return assets.filter((_, i) => allowed[i]);
}
