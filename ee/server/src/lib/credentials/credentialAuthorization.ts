/**
 * Per-credential ACL enforcement through the authorization kernel (EE-only).
 *
 * Semantics (v1, per the plan):
 *  - Unrestricted rows (is_restricted = false) are visible subject to RBAC +
 *    tier + bundle narrowing only.
 *  - Restricted rows are visible only via the existing `own_or_assigned` /
 *    `same_team` templates: owner (created_by), explicit user grants
 *    (credential_access_grants.subject_type='user'), or team grants
 *    (subject_type='team'). No new template keys are introduced.
 *  - Record hydration maps grants to the standard AuthorizationRecord fields:
 *    user grants → assignedUserIds, team grants → teamIds, ownerUserId →
 *    created_by, clientId → owning client.
 *
 * The JS kernel is the correctness path for single-record decisions (reveal,
 * get). The SQL scope path mirrors the same predicate so list/search/counts
 * hide restricted rows in the database; the caller MUST fall back to the JS
 * kernel when the SQL path reports unsupported (bundle constraint not
 * representable).
 */

import type { Knex } from 'knex';
import { resolveAuthorizationSubject } from '@alga-psa/authorization/subject';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
  type RelationshipRule,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { compileBuiltinResolverReadNarrowingSql, compileBundleReadNarrowingSql } from '@alga-psa/authorization/kernel/relationshipTemplates';
import type { RelationshipSqlCompileResult } from '@alga-psa/authorization/kernel/relationshipTemplates';
import type { TenantScopedQuery } from '@alga-psa/db';

/** Physical columns/relations for the credential resource in scoped SQL. */
export function createCredentialRelationshipSqlAdapter(): RelationshipSqlAdapter {
  return {
    // ownerColumn / clientColumn / teamColumn are used by bundle templates
    // compiled via compileBundleReadNarrowingSql (selected_clients, same_team).
    ownerColumn: 'cr.created_by',
    clientColumn: 'cr.client_id',
    // Credentials have no board; selected_boards / same_team bundle templates
    // compiled against a placeholder column resolve to no rows.
    boardColumn: 'cr.credential_id',
    teamColumn: 'cr.created_by',
    applyAssignedUsers(builder, _userIds) {
      // Not used for credentials — user grants live in credential_access_grants
      // and are handled by the dedicated scope compiler below.
      builder.whereRaw('1 = 0');
    },
  };
}

export interface CredentialRow {
  tenant: string;
  credential_id: string;
  client_id: string;
  name: string;
  username: string | null;
  url: string | null;
  description: string | null;
  password_ciphertext: string | null;
  otp_secret_ciphertext: string | null;
  encryption_scheme: string;
  is_restricted: boolean;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CredentialGrantRow {
  subject_type: 'user' | 'team';
  subject_id: string;
}

/**
 * Hydrate a credential row + its grants into the standard AuthorizationRecord.
 * `isRestricted` rides along on the record's open index signature so the
 * decision logic can choose the relationship-rule set per record.
 */
export function toCredentialAuthorizationRecord(
  row: Pick<CredentialRow, 'credential_id' | 'created_by' | 'client_id' | 'is_restricted'>,
  grants: CredentialGrantRow[]
): AuthorizationRecord {
  return {
    id: row.credential_id,
    ownerUserId: row.created_by,
    clientId: row.client_id,
    assignedUserIds: grants.filter((g) => g.subject_type === 'user').map((g) => g.subject_id),
    teamIds: grants.filter((g) => g.subject_type === 'team').map((g) => g.subject_id),
    isRestricted: row.is_restricted === true,
  };
}

/** Builtin relationship rules for a restricted credential row. */
export function getCredentialBuiltinRelationshipRules(isRestricted: boolean): RelationshipRule[] {
  if (!isRestricted) {
    return [];
  }
  return [{ template: 'own_or_assigned' }, { template: 'same_team' }];
}

/**
 * The credential subject: the shared resolver's subject, with one deliberate
 * exception. Credential decisions have never seen a user's reports (`managedUserIds`
 * was always empty here), so a bundle `managed` / `own_or_managed` rule on the
 * credential resource matches only the user's own rows. Resolving the real
 * reports would let a manager reach their reports' credentials under such a rule,
 * which widens access on a dark feature. Lifting this belongs to the slice that
 * decides credential visibility for managers, not to subject resolution.
 */
export async function resolveCredentialAuthorizationSubjectForUser(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  requestCache?: RequestLocalAuthorizationCache
): Promise<AuthorizationSubject> {
  const subject = await resolveAuthorizationSubject(trx, { tenant, user, requestCache });
  return { ...subject, managedUserIds: [] };
}

export interface CredentialAuthorizationContext {
  subject: AuthorizationSubject;
  bundleNarrowingRules: Awaited<ReturnType<typeof resolveBundleNarrowingRulesForEvaluation>>;
  requestCache: RequestLocalAuthorizationCache;
}

/**
 * Build the read-authorization context for a subject once per action, then
 * reuse it across all rows (kernel construction + bundle resolution are the
 * expensive parts).
 */
export async function createCredentialAuthorizationContext(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<CredentialAuthorizationContext> {
  const requestCache = new RequestLocalAuthorizationCache();
  const subject = await resolveCredentialAuthorizationSubjectForUser(trx, tenant, user, requestCache);
  const bundleNarrowingRules = await resolveBundleNarrowingRulesForEvaluation(trx, {
    subject,
    resource: { type: 'credential', action: 'read' },
    requestCache,
    knex: trx,
  });
  return { subject, bundleNarrowingRules, requestCache };
}

export function buildCredentialAuthorizationKernel(
  context: CredentialAuthorizationContext,
  isRestricted: boolean,
  trx: Knex.Transaction
) {
  return createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      relationshipRules: getCredentialBuiltinRelationshipRules(isRestricted),
    }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      // Full assigned rule set, unfiltered: closed-baseline evaluation derives closed bundles from it.
      resolveRules: async () => context.bundleNarrowingRules,
    }),
    rbacEvaluator: async () => true,
  });
}

/**
 * Authorize a single credential row for read/reveal. RBAC + tier are checked by
 * the calling action; this enforces per-item ACLs + bundle narrowing.
 */
export async function authorizeCredentialRecord(
  trx: Knex.Transaction,
  context: CredentialAuthorizationContext,
  row: Pick<CredentialRow, 'credential_id' | 'created_by' | 'client_id' | 'is_restricted'>,
  grants: CredentialGrantRow[]
): Promise<boolean> {
  const record = toCredentialAuthorizationRecord(row, grants);
  const kernel = buildCredentialAuthorizationKernel(context, record.isRestricted === true, trx);
  const decision = await kernel.authorizeResource({
    subject: context.subject,
    resource: { type: 'credential', action: 'read', id: row.credential_id },
    record,
    requestCache: context.requestCache,
    knex: trx,
  });
  return decision.allowed;
}

/**
 * Apply the credential read-scope predicate onto a tenant-scoped query:
 *
 *   is_restricted = false
 *   OR created_by = :userId
 *   OR EXISTS(user grant = :userId)
 *   OR EXISTS(team grant IN :teamIds)
 *
 * ANDed with every matching bundle-narrowing rule. Restricted rows that do not
 * match a grant are invisible — exactly the JS-kernel decision.
 */
export function compileCredentialReadScopeSql(
  query: TenantScopedQuery,
  context: CredentialAuthorizationContext
): RelationshipSqlCompileResult {
  const { subject } = context;
  if (query.tenant !== subject.tenant) {
    throw new Error(
      `Credential scope query tenant ${query.tenant} does not match subject tenant ${subject.tenant}`
    );
  }

  const builder = query.builder;
  builder.where(function orScope(this: Knex.QueryBuilder) {
    this.where('cr.is_restricted', false);
    this.orWhere('cr.created_by', subject.userId);
    this.orWhere(function userGrant(this: Knex.QueryBuilder) {
      this.whereExists(function existsUser(this: Knex.QueryBuilder) {
        this.select(1)
          .from('credential_access_grants as g')
          .whereRaw('g.tenant = cr.tenant')
          .whereRaw('g.credential_id = cr.credential_id')
          .where('g.subject_type', 'user')
          .where('g.subject_id', subject.userId);
      });
    });
    this.orWhere(function teamGrant(this: Knex.QueryBuilder) {
      const teamIds = (subject.teamIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (teamIds.length === 0) {
        this.whereRaw('1 = 0');
        return;
      }
      this.whereExists(function existsTeam(this: Knex.QueryBuilder) {
        this.select(1)
          .from('credential_access_grants as g')
          .whereRaw('g.tenant = cr.tenant')
          .whereRaw('g.credential_id = cr.credential_id')
          .where('g.subject_type', 'team')
          .whereIn('g.subject_id', teamIds);
      });
    });
  });

  // AND bundle narrowing (selected_clients → client_id, etc.). When a rule is
  // not representable the caller falls back to the JS kernel.
  const sqlContext = { subject, adapter: createCredentialRelationshipSqlAdapter() };
  // Registered built-in rule resolvers narrow first (closed baselines included), then bundles.
  const resolverResult = compileBuiltinResolverReadNarrowingSql(builder, 'credential', 'read', sqlContext);
  if (!resolverResult.supported) return resolverResult;
  return compileBundleReadNarrowingSql(builder, context.bundleNarrowingRules, 'credential', 'read', sqlContext);
}
