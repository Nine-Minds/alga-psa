import type { Knex } from 'knex';
import {
  RequestLocalAuthorizationCache,
  closedBundlesNotNaming,
  CLIENT_SCOPE_TEMPLATES,
  matchRulesForAction,
  compileBundleReadNarrowingSql,
  type AuthorizationRequestCache,
  type AuthorizationSubject,
  type BundleNarrowingRule,
  type RelationshipSqlAdapter,
} from './kernel';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';
import { resolveAuthorizationSubject } from './subject/resolver';
import type { SubjectUserInput } from './subject/assemble';
import { probeTenantAuthorizationScope } from './subject/tenantScope';

/**
 * Client read scope: "show this subject only the records of their in-scope clients", for a resource
 * whose reads are plain SQL lists (interactions, time entries, ...).
 *
 * A subject is client-restricted when a published bundle names the resource with a client template
 * (`same_client`, `client_portfolio`, `selected_clients`) or a closed bundle does not name it. Every
 * other rule (`managed`, `own`, `selected_boards`, field redaction, ...) is neutralised here: it still
 * counts for the closed baseline, but it neither narrows nor fails the read. Those rules belong to the
 * resource's own screens; this layer answers one question, which clients the subject may see.
 *
 * Neutral by construction: a tenant with no published assignment is answered by the one cached tenant
 * probe, so no subject, portfolio or rule is loaded and `apply` adds nothing to the query.
 */

export { CLIENT_SCOPE_TEMPLATES };

export interface ClientReadScope {
  /** False on the fast path: nothing narrows this subject, `apply` is a no-op and no subject was resolved. */
  readonly narrowed: boolean;
  /** Narrow `builder` (a tenant-scoped query on the resource's table, aliased as the adapter expects). */
  apply(builder: Knex.QueryBuilder): void;
  /**
   * Narrow `builder` through a different physical mapping than the one the scope was resolved with. The subject
   * and its rules are resolved once; a query that names several tables (a report) maps each table's client
   * through its own adapter. A no-op when not narrowed.
   */
  // LEVERAGE: friction client-read-scope-single-adapter — the scope was built around one resource's adapter; a report needs one
  // resolved subject mapped through many tables' adapters, so `applyWith` was bolted on beside `apply`. The scope is really
  // "the subject's client set"; the adapter belongs to the call.
  applyWith(builder: Knex.QueryBuilder, adapter: RelationshipSqlAdapter): void;
  /** The resolved subject; null on the fast path (nothing was resolved). */
  readonly subject: AuthorizationSubject | null;
}

export interface ResolveClientReadScopeInput {
  tenant: string;
  user: SubjectUserInput;
  /** The kernel resource type whose bundle rules narrow the read (e.g. `interaction`, `time_entry`). */
  resourceType: string;
  /** The physical mapping of the resource. Built from the resolved subject (some rules depend on who is asking). */
  createAdapter(subject: AuthorizationSubject): RelationshipSqlAdapter;
  /** Share one cache across a request so the tenant probe runs once. */
  requestCache?: AuthorizationRequestCache;
}

const UNNARROWED: ClientReadScope = Object.freeze({ narrowed: false, apply: () => undefined, applyWith: () => undefined, subject: null });

function clientScopeOnly(rule: BundleNarrowingRule): BundleNarrowingRule {
  const narrowsByClient =
    typeof rule.templateKey === 'string' &&
    CLIENT_SCOPE_TEMPLATES.has(rule.templateKey) &&
    rule.constraintKey !== 'client_visible_only';
  // Keep the rule, change it: dropping it would make a closed bundle look as if it did not name the resource.
  return narrowsByClient ? { ...rule, constraintKey: null } : { ...rule, templateKey: null, constraintKey: null };
}

export async function resolveClientReadScope(
  knex: Knex | Knex.Transaction,
  input: ResolveClientReadScopeInput
): Promise<ClientReadScope> {
  const { tenant, user, resourceType } = input;
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();

  // Fast path. No published assignment means no bundle rule can apply to anyone in this tenant, and a
  // portfolio only has an effect through a bundle's client template.
  const tenantScope = await probeTenantAuthorizationScope(knex, tenant, requestCache);
  if (!tenantScope.publishedAssignments) return UNNARROWED;

  const subject = await resolveAuthorizationSubject(knex, { tenant, user, requestCache });
  const rules = (
    await resolveBundleNarrowingRulesForEvaluation(knex, {
      subject,
      resource: { type: resourceType, action: 'read' },
      requestCache,
      knex: knex as Knex,
    })
  ).map(clientScopeOnly);

  const narrowsHere =
    matchRulesForAction(rules, resourceType, 'read').some((rule) => rule.templateKey) ||
    closedBundlesNotNaming(rules, resourceType, 'read').length > 0;
  if (!narrowsHere) return UNNARROWED;

  const applyWith = (builder: Knex.QueryBuilder, adapter: RelationshipSqlAdapter) => {
    const compiled = compileBundleReadNarrowingSql(builder, rules, resourceType, 'read', { subject, adapter });
    // Every rule was reduced to what the SQL compiler expresses. If that ever stops being true, deny: never run a partial predicate.
    if (compiled.supported === false) builder.whereRaw('1 = 0');
  };
  const defaultAdapter = input.createAdapter(subject);
  return {
    narrowed: true,
    subject,
    apply: (builder) => applyWith(builder, defaultAdapter),
    applyWith,
  };
}
