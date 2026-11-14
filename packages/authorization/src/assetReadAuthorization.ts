import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationDecision,
  type AuthorizationEvaluationInput,
  type AuthorizationKernel,
  type AuthorizationMutationDecision,
  type AuthorizationRecord,
  type AuthorizationRequestCache,
  type AuthorizationSubject,
} from './kernel';
import { resolveAuthorizationSubject } from './subject/resolver';
import type { BundleNarrowingRule } from './kernel/providers/bundleProvider';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';
import { createBundleNarrowingProvider } from './bundles/narrowingProvider';
import { projectReadableRecord } from './recordProjection';
import { hasBuiltinRuleResolversWithoutFactSource, hasRegisteredBuiltinRuleResolvers } from './kernel/builtinRuleResolvers';
import { builtinClosedFields, builtinClosedOperations, builtinResolversCloseAction, builtinResolversConcealDenials, isBuiltinOperationClosed } from './kernel/builtinRuleResolvers';

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
  roles?: Array<{ role_id?: string } | string>;
};

export type AssetAuthorizationInput = { asset_id: string; client_id?: string | null };

export type AssetReadAuthorizationContext = {
  subject: AuthorizationSubject;
  authorizationKernel: ReturnType<typeof createAuthorizationKernel>;
  requestCache: RequestLocalAuthorizationCache;
};

/** Asset callers' entry to the shared resolver; kept so the asset surface keeps its name. */
export async function resolveAuthorizationSubjectForUser(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  apiKeyId?: string,
  requestCache?: AuthorizationRequestCache
): Promise<AuthorizationSubject> {
  return resolveAuthorizationSubject(trx, { tenant, user, apiKeyId, requestCache });
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
    bundleProvider: createBundleNarrowingProvider(trx),
    rbacEvaluator: async () => true,
  });
}

export async function createAssetReadContext(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser
): Promise<AssetReadAuthorizationContext> {
  const requestCache = new RequestLocalAuthorizationCache();
  return {
    subject: await resolveAuthorizationSubjectForUser(trx, tenant, user, undefined, requestCache),
    authorizationKernel: createAssetReadKernel(trx),
    requestCache,
  };
}

/** Build an asset authorization context from one already-resolved policy snapshot. */
export async function createAssetReadContextWithRules(
  trx: Knex | Knex.Transaction,
  subject: AuthorizationSubject,
  rules: readonly BundleNarrowingRule[],
  requestCache: RequestLocalAuthorizationCache = new RequestLocalAuthorizationCache()
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
    requestCache,
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
 * One asset decision for `action`. A read asks the kernel for the resource decision; a write asks for
 * the mutation decision, where the kernel refuses a record the subject's read rules do not allow
 * before it evaluates the write rules.
 */
async function isAssetRequestDecision(
  kernel: AuthorizationKernel,
  request: Omit<AuthorizationEvaluationInput, 'resource'> & { resource: { type: 'asset'; id?: string } },
  action: AssetAuthorizationAction
): Promise<AuthorizationDecision | AuthorizationMutationDecision> {
  const evaluation = { ...request, resource: { ...request.resource, action } };
  return action === 'read'
    ? kernel.authorizeResource(evaluation)
    : kernel.authorizeMutation(evaluation);
}

async function isAssetRequestAllowed(
  kernel: AuthorizationKernel,
  request: Omit<AuthorizationEvaluationInput, 'resource'> & { resource: { type: 'asset'; id?: string } },
  action: AssetAuthorizationAction
): Promise<boolean> {
  return (await isAssetRequestDecision(kernel, request, action)).allowed;
}

/**
 * True when the caller's per-record kernel decision allows `action` on the asset. The action selects which
 * bundle rules narrow the decision (a bundle's `asset:update` rule is not its `asset:read` rule), so mutations
 * must ask for the action they perform. Mutations also require read visibility, which the kernel enforces.
 * Coarse RBAC is not evaluated here; callers pre-filter with it.
 */
export async function isAssetActionAllowed(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  asset: AssetAuthorizationInput,
  action: AssetAuthorizationAction
): Promise<boolean> {
  const records = await resolveAssetAuthorizationRecords(trx, tenant, [asset]);
  return isAssetRequestAllowed(context.authorizationKernel, {
    subject: context.subject,
    resource: { type: 'asset', id: asset.asset_id },
    record: records.get(asset.asset_id),
    requestCache: context.requestCache,
    knex: trx as Knex,
  }, action);
}

/**
 * Batch authorization for one asset action. Records are resolved with one association query, while the
 * authorization kernel still evaluates each record separately (including bundle and same-team rules).
 * Decisions align with the input rows so callers can retain field policies through pagination and enrichment.
 */
export async function authorizeAssetsForAction<T extends AssetAuthorizationInput>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  assets: readonly T[],
  action: 'read',
  options?: { resolveMultiUserOwnersIndividually?: boolean }
): Promise<AuthorizationDecision[]>;
export async function authorizeAssetsForAction<T extends AssetAuthorizationInput>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  assets: readonly T[],
  action: AssetAuthorizationAction,
  options?: { resolveMultiUserOwnersIndividually?: boolean }
): Promise<Array<AuthorizationDecision | AuthorizationMutationDecision>>;
export async function authorizeAssetsForAction<T extends AssetAuthorizationInput>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  assets: readonly T[],
  action: AssetAuthorizationAction,
  options?: { resolveMultiUserOwnersIndividually?: boolean }
): Promise<Array<AuthorizationDecision | AuthorizationMutationDecision>> {
  if (assets.length === 0) return [];
  const records = await resolveAssetAuthorizationRecords(trx, tenant, [...assets]);
  return Promise.all(assets.map(async (asset) => {
    let record = records.get(asset.asset_id);
    if (options?.resolveMultiUserOwnersIndividually && action === 'read' && (record?.assignedUserIds?.length ?? 0) > 1) {
      record = (await resolveAssetAuthorizationRecords(trx, tenant, [asset])).get(asset.asset_id);
    }
    return isAssetRequestDecision(context.authorizationKernel, {
      subject: context.subject,
      resource: { type: 'asset', id: asset.asset_id },
      record,
      requestCache: context.requestCache,
      knex: trx as Knex,
    }, action);
  }));
}

export async function filterAssetsAllowedForAction<T extends AssetAuthorizationInput>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  assets: readonly T[],
  action: AssetAuthorizationAction,
  options?: { resolveMultiUserOwnersIndividually?: boolean }
): Promise<T[]> {
  const decisions = await authorizeAssetsForAction(trx, tenant, context, assets, action, options);
  return assets.filter((_, index) => decisions[index].allowed);
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
  const clientKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (evaluation) => {
        const rules = await resolveBundleNarrowingRulesForEvaluation(trx as Knex.Transaction, evaluation);
        // Keep every rule: the provider derives closed bundles from the full assigned rule set, so dropping a
        // rule can make a closed bundle look like it does not name the resource (or hide it entirely).
        // Rules whose template is not a client-scope template are neutralised instead: they still name the
        // resource and action, but do not narrow at client level.
        return rules.map((rule) =>
          rule.templateKey && CLIENT_SCOPE_TEMPLATES.has(rule.templateKey) ? rule : { ...rule, templateKey: null }
        );
      },
    }),
    // Coarse asset RBAC is checked by the action boundary before this function.
    rbacEvaluator: async () => true,
  });
  return isAssetRequestAllowed(clientKernel, {
    subject: context.subject,
    resource: { type: 'asset' },
    record: { clientId },
    requestCache: context.requestCache,
    knex: trx as Knex,
  }, action);
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
export function isAssetMutationAllowed(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  asset: AssetAuthorizationInput,
  action: 'update' | 'delete'
): Promise<boolean> {
  return isAssetActionAllowed(trx, tenant, context, asset, action);
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

/**
 * The assets the caller may read, each as the caller may see it: fields the read decision redacts are omitted
 * the way the REST asset endpoints omit them, and an asset whose identity is redacted (or that is not readable)
 * is dropped. Rows of a caller without redactions are returned untouched.
 */
export async function projectReadableAssets<T extends AssetAuthorizationInput>(
  trx: Knex | Knex.Transaction,
  tenant: string,
  context: AssetReadAuthorizationContext,
  assets: readonly T[]
): Promise<T[]> {
  const decisions = await authorizeAssetsForAction(trx, tenant, context, assets, 'read');
  const projected = assets.map((asset, index) => {
    const decision = decisions[index];
    return decision.allowed ? projectReadableRecord('asset', asset, decision.redactedFields) : null;
  });
  return projected.filter((asset): asset is NonNullable<typeof asset> => asset !== null) as T[];
}

/**
 * Asset columns (and joined display columns) a registered built-in resolver closes to this subject. A read path
 * leaves them out of its query; the decision's `redactedFields` carry the same list as a safety net.
 */
export function assetClosedFields(subject: AuthorizationSubject): string[] {
  return builtinClosedFields({ subject, resource: { type: 'asset', action: 'read' } });
}

/** Whether a built-in resolver closes the named asset operation (`remote_access`, `rmm_command`, ...) to this subject. */
export function isAssetOperationClosed(subject: AuthorizationSubject, operation: string): boolean {
  return isBuiltinOperationClosed({ subject, resource: { type: 'asset', action: operation } });
}

/** Every asset operation closed to this subject; what a screen consults to decide which controls to render. */
export function assetClosedOperations(subject: AuthorizationSubject): string[] {
  return builtinClosedOperations({ subject, resource: { type: 'asset', action: 'read' } });
}

/**
 * {@link isAssetOperationClosed} for a user the caller has no subject for. Callers that hold a read context use
 * `isAssetOperationClosed(context.subject, ...)` instead and pay nothing. Here the full subject (roles, teams,
 * reports, resolver facts) is only resolved for a user a resolver may govern: with no resolver registered nothing
 * is read, and otherwise one indexed lookup in the resolver membership index (retained for every row-backed
 * subject, live or revoked) settles an ordinary MSP user.
 */
export async function isAssetOperationClosedForUser(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  operation: string
): Promise<boolean> {
  if (!hasRegisteredBuiltinRuleResolvers()) return false;
  if (!hasBuiltinRuleResolversWithoutFactSource()) {
    const member = await tenantDb(trx, tenant).table('authorization_resolver_subjects')
      .where({ user_id: user.user_id }).first('user_id');
    if (!member) return false;
  }
  return isAssetOperationClosed(await resolveAuthorizationSubjectForUser(trx, tenant, user), operation);
}

/** Throws the kernel's standard denial when the named asset operation is closed to the user. */
export async function assertAssetOperationOpen(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  operation: string
): Promise<void> {
  if (await isAssetOperationClosedForUser(trx, tenant, user, operation)) {
    throw new Error(`Permission denied: Cannot ${operation.replace(/_/g, ' ')} on assets`);
  }
}

/** The asset actions (`create`, `update`, `delete`) a closed baseline denies this subject outright, whatever the record. */
export function assetClosedActions(subject: AuthorizationSubject): string[] {
  return ['create', 'update', 'delete'].filter((action) =>
    builtinResolversCloseAction({ subject, resource: { type: 'asset', action } }));
}

/** Whether a record this subject may not read must answer as missing (a closed-baseline subject) rather than forbidden. */
export function assetDenialsConcealed(subject: AuthorizationSubject): boolean {
  return builtinResolversConcealDenials({ subject, resource: { type: 'asset', action: 'read' } });
}

let assetColumnNames: string[] | undefined;

/**
 * The `assets` columns a read may select once `closed` (columns a built-in resolver closes to the subject, see
 * `assetClosedFields`) are left out, so a closed column never leaves the database. Null when nothing is closed:
 * the read keeps `assets.*` and its statement is the one it always was. Fields in `closed` that are not `assets`
 * columns (a joined display name) match nothing here and are handled by the read that joins them.
 * Shared by the asset server actions and the REST asset service.
 */
export async function assetColumnsOpenTo(
  trx: Knex | Knex.Transaction,
  closed: readonly string[],
  table = 'assets'
): Promise<string[] | null> {
  if (closed.length === 0) return null;
  assetColumnNames ??= (await trx.raw(
    'select column_name from information_schema.columns where table_schema = current_schema() and table_name = ?',
    ['assets']
  )).rows.map((row: { column_name: string }) => row.column_name);
  return assetColumnNames!.filter((column) => !closed.includes(column)).map((column) => `${table}.${column}`);
}
