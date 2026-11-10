import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import {
  RequestLocalAuthorizationCache,
  compileResourceReadAuthorizationSql,
  matchRulesForAction,
  type AuthorizationSubject,
  type BundleNarrowingRule,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';
import { resolveAuthorizationSubject } from '@alga-psa/authorization/subject';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import type { AuthorizationResourceType } from '@alga-psa/authorization/bundles/catalog';
import {
  createClientRelationshipSqlAdapter,
  createContactRelationshipSqlAdapter,
} from './clientScopeSqlAdapters';

/**
 * Bundle client-scope narrowing for clients and contacts, compiled into the SQL
 * that produces the rows, so totals, counts and pagination come from the
 * narrowed query. Nothing here filters rows after the query.
 *
 * One context per request: the subject is resolved once (S2 resolver, with the
 * tenant fast path) and its request cache is shared by every narrowing built
 * from it. A tenant with no published bundle assignment resolves no rules, so
 * `narrow` adds nothing and the query is exactly what it was before.
 */

type ClientScopeResource = Extract<AuthorizationResourceType, 'client' | 'contact'>;

// LEVERAGE: pattern resource-sql-narrowing — adapter + rule resolve + compile + fail-closed fallback is the same shape as
// applyTicketReadAuthorizationSql; a per-resource "narrow this query" layer in @alga-psa/authorization would absorb it.
const RESOURCES: Record<
  ClientScopeResource,
  { adapter: (alias: string) => RelationshipSqlAdapter; defaultAlias: string; clientRequired: boolean }
> = {
  client: { adapter: createClientRelationshipSqlAdapter, defaultAlias: 'clients', clientRequired: false },
  // A contact with no client belongs to no client in scope: hidden once any rule narrows.
  contact: { adapter: createContactRelationshipSqlAdapter, defaultAlias: 'contacts', clientRequired: true },
};

export interface ClientScopeNarrowing {
  /** True when at least one bundle rule narrows this resource for the subject. */
  readonly narrowed: boolean;
  /** AND the narrowing predicate onto `query`. A no-op when not narrowed. */
  apply<T extends Knex.QueryBuilder>(query: T): T;
}

export interface ClientScopeContext {
  readonly subject: AuthorizationSubject;
  narrowing(resource: ClientScopeResource, alias?: string): Promise<ClientScopeNarrowing>;
  /**
   * Whether the one row `id` is in scope: an existence query carrying the same
   * compiled predicate as the lists, so a detail read and a list never disagree.
   */
  permits(resource: ClientScopeResource, id: string): Promise<boolean>;
}

/** Rules that only redact fields never narrow rows; the SQL compiler does not model them. */
function rowNarrowingRule(rule: BundleNarrowingRule): BundleNarrowingRule {
  return rule.constraintKey === 'hide_sensitive_fields' ? { ...rule, constraintKey: null } : rule;
}

export async function createClientScopeContext(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  requestCache: RequestLocalAuthorizationCache = new RequestLocalAuthorizationCache()
): Promise<ClientScopeContext> {
  // A failed resolution propagates: a subject that cannot be resolved gets no rows.
  const subject = await resolveAuthorizationSubject(conn, { tenant, user, requestCache });

  // Rules are resolved once per resource per request.
  const rulesByResource = new Map<ClientScopeResource, Promise<BundleNarrowingRule[]>>();

  const context: ClientScopeContext = {
    subject,
    async permits(resource, id) {
      const narrowing = await context.narrowing(resource, 'r');
      if (!narrowing.narrowed) return true;
      const table = resource === 'client' ? 'clients' : 'contacts';
      const idColumn = resource === 'client' ? 'r.client_id' : 'r.contact_name_id';
      const row = await narrowing.apply(tenantDb(conn, tenant).table(`${table} as r`).where(idColumn, id)).first(idColumn);
      return Boolean(row);
    },
    async narrowing(resource, alias) {
      const def = RESOURCES[resource];
      const columnAlias = alias ?? def.defaultAlias;
      let pending = rulesByResource.get(resource);
      if (!pending) {
        pending = resolveBundleNarrowingRulesForEvaluation(conn, {
          subject,
          resource: { type: resource, action: 'read' },
          requestCache,
          knex: conn,
        }).then((resolved) => resolved.map(rowNarrowingRule));
        rulesByResource.set(resource, pending);
      }
      const rules = await pending;
      const matching = matchRulesForAction(rules, resource, 'read');
      if (matching.length === 0) {
        return { narrowed: false, apply: (query) => query };
      }

      const adapter = def.adapter(columnAlias);
      return {
        narrowed: true,
        apply(query) {
          query.andWhere(function narrowToScope(this: Knex.QueryBuilder) {
            const result = compileResourceReadAuthorizationSql(this, {
              resourceType: resource,
              action: 'read',
              builtinRules: [],
              bundleRules: rules,
              ctx: { subject, adapter },
            });
            if (!result.supported) {
              // A rule SQL cannot express must not widen the answer: no rows.
              this.whereRaw('1 = 0');
            }
            if (def.clientRequired && adapter.clientColumn) this.whereNotNull(adapter.clientColumn);
          });
          return query;
        },
      };
    },
  };
  return context;
}
