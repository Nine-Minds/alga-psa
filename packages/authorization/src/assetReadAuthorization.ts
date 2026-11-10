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
import type { BundleNarrowingRule } from './kernel/providers/bundleProvider';
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
  /** Verified API-key principal used by bundle target narrowing. */
  apiKeyId?: string | null;
  client_id?: string | null;
  role_ids?: string[];
  portfolio_client_ids?: string[];
  portfolioClientIds?: string[];
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
  user: AssetAuthUser,
  apiKeyId?: string
): Promise<AuthorizationSubject> {
  const db = tenantDb(trx, tenant);
  let roleIds = extractRoleIdsFromUser(user);
  roleIds = Array.from(new Set([...roleIds, ...(user.role_ids ?? [])]));
  if (roleIds.length === 0) {
    const roleRows = await db.table('user_roles').where({ user_id: user.user_id }).select<{ role_id: string }[]>('role_id');
    roleIds = roleRows.map((row) => row.role_id);
  }

  const [teamRows, managedRows] = await Promise.all([
    db.table('team_members').where({ user_id: user.user_id }).select<{ team_id: string }[]>('team_id'),
    db.table('users').where({ reports_to: user.user_id }).select<{ user_id: string }[]>('user_id'),
  ]);

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? user.client_id ?? null,
    portfolioClientIds: Array.from(new Set([
      ...(user.portfolio_client_ids ?? []),
      ...(user.portfolioClientIds ?? []),
      ...((user.clientId ?? user.client_id) ? [user.clientId ?? user.client_id!] : []),
    ])),
    ...((apiKeyId ?? user.apiKeyId) ? { apiKeyId: apiKeyId ?? user.apiKeyId } : {}),
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
    .orderBy('created_at', 'asc')
    .orderBy('entity_id', 'asc')
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

/** Build an asset authorization context from one already-resolved policy snapshot. */
export async function createAssetReadContextWithRules(
  trx: Knex | Knex.Transaction,
  subject: AuthorizationSubject,
  rules: readonly BundleNarrowingRule[]
): Promise<AssetReadAuthorizationContext> {
  return {
    subject,
    authorizationKernel: createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: async () => [...rules],
      }),
      rbacEvaluator: async () => true,
    }),
    requestCache: new RequestLocalAuthorizationCache(),
  };
}

export type AssetAuthorizationAction = 'read' | 'update' | 'delete';

/**
 * Evaluate the asset read boundary for a client, including when a group has no assets yet.
 * Member-specific update rules are evaluated separately against each real asset record.
 * Callers must still enforce coarse RBAC before using this narrowing check.
 */
export async function isAssetClientReadAllowed(
  trx: Knex | Knex.Transaction,
  context: AssetReadAuthorizationContext,
  clientId: string
): Promise<boolean> {
  const decision = await context.authorizationKernel.authorizeResource({
    subject: context.subject,
    resource: { type: 'asset', action: 'read' },
    record: { clientId },
    requestCache: context.requestCache,
    knex: trx,
  });
  return decision.allowed;
}

/**
 * True when the caller's per-record kernel decision allows `action` on the asset. The action selects which
 * bundle rules narrow the decision (a bundle's `asset:update` rule is not its `asset:read` rule), so mutations
 * must ask for the action they perform. Mutations also require read visibility. Coarse RBAC is not
 * evaluated here; callers pre-filter with it.
 */
export async function isAssetActionAllowed(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  asset: AssetAuthorizationInput,
  action: AssetAuthorizationAction
): Promise<boolean> {
  const records = await resolveAssetAuthorizationRecords(trx, tenant, [asset]);
  const request = {
    subject: context.subject,
    resource: { type: 'asset' as const, action: 'read' as const, id: asset.asset_id },
    record: records.get(asset.asset_id),
    requestCache: context.requestCache,
    knex: trx as Knex,
  };
  const readDecision = await context.authorizationKernel.authorizeResource(request);
  if (!readDecision.allowed || action === 'read') return readDecision.allowed;

  const actionDecision = await context.authorizationKernel.authorizeResource({
    ...request,
    resource: { ...request.resource, action },
  });
  return actionDecision.allowed;
}

/**
 * Batch authorization for one asset action. Records are resolved with one association query, while the
 * authorization kernel still evaluates each record separately (including bundle and same-team rules).
 */
export async function filterAssetsAllowedForAction<T extends AssetAuthorizationInput>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  assets: readonly T[],
  action: AssetAuthorizationAction,
  options?: { resolveMultiUserOwnersIndividually?: boolean }
): Promise<T[]> {
  if (assets.length === 0) return [];
  const records = await resolveAssetAuthorizationRecords(trx, tenant, [...assets]);
  const allowed = await Promise.all(assets.map(async (asset) => {
    const record = records.get(asset.asset_id);
    const request = {
      subject: context.subject,
      resource: { type: 'asset' as const, action: 'read' as const, id: asset.asset_id },
      record,
      requestCache: context.requestCache,
      knex: trx as Knex,
    };
    // The association query has no ordering, so batching can change which user is treated as the owner.
    if (options?.resolveMultiUserOwnersIndividually && action === 'read' && (record?.assignedUserIds?.length ?? 0) > 1) {
      return isAssetReadAllowed(trx, tenant, context, asset);
    }
    const readDecision = await context.authorizationKernel.authorizeResource(request);
    if (!readDecision.allowed || action === 'read') return readDecision.allowed;
    const actionDecision = await context.authorizationKernel.authorizeResource({
      ...request,
      resource: { ...request.resource, action },
    });
    return actionDecision.allowed;
  }));
  return assets.filter((_, index) => allowed[index]);
}

const CLIENT_SCOPE_TEMPLATES = new Set(['same_client', 'client_portfolio', 'selected_clients']);

/**
 * Evaluate only client-level asset restrictions for a client record. Asset
 * relationship rules such as same_team and assigned are evaluated against each
 * real asset separately; applying them to a client would lose the asset's
 * relationships and incorrectly deny otherwise authorized group operations.
 */
export async function isAssetClientActionAllowed(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  clientId: string,
  action: AssetAuthorizationAction
): Promise<boolean> {
  const input = {
    subject: context.subject,
    resource: { type: 'asset', action },
    record: { clientId },
    requestCache: context.requestCache,
    knex: trx as Knex,
  };
  const clientKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (evaluation) => {
        const rules = await resolveBundleNarrowingRulesForEvaluation(trx as Knex.Transaction, evaluation);
        return rules.filter((rule) => rule.templateKey && CLIENT_SCOPE_TEMPLATES.has(rule.templateKey));
      },
    }),
    // Coarse asset RBAC is checked by the action boundary before this function.
    rbacEvaluator: async () => true,
  });
  return (await clientKernel.authorizeResource(input)).allowed;
}

/** True when the caller's per-record kernel decision allows reading the asset. */
export function isAssetReadAllowed(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  asset: AssetAuthorizationInput
): Promise<boolean> {
  return isAssetActionAllowed(trx, tenant, context, asset, 'read');
}

/** Mutations require both visibility of the asset and permission for the requested operation. */
export async function isAssetMutationAllowed(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  asset: AssetAuthorizationInput,
  action: 'update' | 'delete'
): Promise<boolean> {
  return await isAssetReadAllowed(trx, tenant, context, asset) &&
    await isAssetActionAllowed(trx, tenant, context, asset, action);
}

/**
 * Load an asset and enforce its record-level read decision using the same
 * transaction the caller will use for the protected operation. A null result
 * deliberately combines missing and unreadable assets to avoid an existence
 * oracle at ID-based action boundaries.
 */
export async function loadReadableAssetById(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  assetId: string
): Promise<AssetAuthorizationInput | null> {
  const asset = await tenantDb(trx, tenant)
    .table('assets')
    .where({ asset_id: assetId })
    .select('asset_id', 'client_id')
    .first() as AssetAuthorizationInput | undefined;

  if (!asset) return null;
  const context = await createAssetReadContext(trx, tenant, user);
  return await isAssetReadAllowed(trx, tenant, context, asset) ? asset : null;
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
  assets: readonly T[],
  options?: { resolveMultiUserOwnersIndividually?: boolean }
): Promise<T[]> {
  return filterAssetsAllowedForAction(trx, tenant, context, assets, 'read', options);
}
