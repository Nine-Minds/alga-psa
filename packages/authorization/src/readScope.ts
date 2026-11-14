import type { Knex } from 'knex';
import type {
  AuthorizationRequestCache,
  AuthorizationSubject,
  RelationshipRule,
} from './kernel/contracts';
import { RequestLocalAuthorizationCache } from './kernel/requestCache';
import { matchRulesForAction } from './kernel/actionAliases';
import { closedBundlesNotNaming } from './kernel/closedBaseline';
import { builtinResolversRestrict } from './kernel/builtinRuleResolvers';
import type { BundleNarrowingRule } from './kernel/providers/bundleProvider';
import {
  compileResourceReadAuthorizationSql,
  type RelationshipSqlAdapter,
} from './kernel/relationshipTemplates';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';
import { resolveAuthorizationSubject } from './subject/resolver';
import { probeTenantAuthorizationScope } from './subject/tenantScope';
import type { SubjectUserInput } from './subject/assemble';

// ---------------------------------------------------------------------------
// A subject's read scope over one resource, for list queries.
//
// `resolveNarrowedReadScope` answers "is this subject narrowed for <resource>:read?"
// without cost for the common case. A tenant with no published bundle assignment is on
// the S2 fast path: one cached probe statement, then null (no clause, nothing else
// loaded). Only a tenant that does use bundles resolves the subject and its rules.
//
// `applyReadScope` compiles that scope onto a query through the resource's
// RelationshipSqlAdapter, using the same compiler the ticket list uses.
// ---------------------------------------------------------------------------

export interface NarrowedReadScope {
  subject: AuthorizationSubject;
  bundleRules: BundleNarrowingRule[];
}

export interface ResolveNarrowedReadScopeInput {
  tenant: string;
  user: SubjectUserInput;
  resourceType: string;
  action?: string;
  requestCache?: AuthorizationRequestCache;
}

/** The subject's narrowing for `resourceType:action`, or null when nothing narrows it (add no clause). */
export async function resolveNarrowedReadScope(
  conn: Knex | Knex.Transaction,
  input: ResolveNarrowedReadScopeInput
): Promise<NarrowedReadScope | null> {
  const action = input.action ?? 'read';
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();

  // Fast path: no published assignment in the tenant, so no subject has a bundle rule, and no built-in resolver
  // (a co-managed seat, say) has a subject here either. The probe answers both in the one statement.
  const tenantScope = await probeTenantAuthorizationScope(conn, input.tenant, requestCache);
  if (!tenantScope.publishedAssignments && tenantScope.resolverSubjects === false) return null;

  // A fault in either load propagates: a scope that cannot be resolved must not read as "unrestricted".
  const subject = await resolveAuthorizationSubject(conn, { tenant: input.tenant, user: input.user, requestCache });
  const bundleRules = await resolveBundleNarrowingRulesForEvaluation(conn, {
    subject,
    resource: { type: input.resourceType, action },
    requestCache,
    knex: conn,
  });

  const narrows =
    matchRulesForAction(bundleRules, input.resourceType, action).length > 0 ||
    closedBundlesNotNaming(bundleRules, input.resourceType, action).length > 0 ||
    builtinResolversRestrict({ subject, resource: { type: input.resourceType, action } });
  return narrows ? { subject, bundleRules } : null;
}

export interface ApplyReadScopeInput {
  resourceType: string;
  action?: string;
  /** Built-in rules of the resource for this subject (OR-group), ANDed with the bundle rules. */
  builtinRules?: RelationshipRule[];
  adapter: RelationshipSqlAdapter;
}

/**
 * Bundle rules that never deny a read. `hide_sensitive_fields` only redacts; the SQL compiler
 * reports it unsupported because it has no per-row redaction metadata, but a visibility
 * prefilter does not need any: the record check that follows still redacts.
 */
// LEVERAGE: friction sql-compiler-redaction-unsupported — the compiler reports a redaction-only constraint as
// unsupported, so every visibility prefilter has to strip it first; the compiler should classify it as a no-op.
// The compiler now treats hide_sensitive_fields as a read no-op (relationshipTemplates.ts), so this strip, the one in
// clientScopeAuthorization.ts and the one in ticketScopeAuthorization.ts are redundant and can be removed together.
function withoutRedactionOnlyConstraints(rules: BundleNarrowingRule[]): BundleNarrowingRule[] {
  return rules.map((rule) =>
    rule.constraintKey === 'hide_sensitive_fields' ? { ...rule, constraintKey: null } : rule
  );
}

/**
 * Narrow `builder` to rows the scope may read. A policy the compiler cannot express denies
 * every row (fail closed); it is never run partially compiled.
 */
export function applyReadScope(
  builder: Knex.QueryBuilder,
  scope: NarrowedReadScope,
  input: ApplyReadScopeInput
): void {
  const params = {
    resourceType: input.resourceType,
    action: input.action ?? 'read',
    builtinRules: input.builtinRules ?? [],
    bundleRules: withoutRedactionOnlyConstraints(scope.bundleRules),
    ctx: { subject: scope.subject, adapter: input.adapter },
  };
  // Compile onto a throwaway builder first: support is only known after the walk.
  const probe = builder.client.queryBuilder();
  if (!compileResourceReadAuthorizationSql(probe, params).supported) {
    builder.whereRaw('1 = 0');
    return;
  }
  compileResourceReadAuthorizationSql(builder, params);
}
