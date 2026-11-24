import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import {
  RequestLocalAuthorizationCache,
  type AuthorizationSubject,
  type RelationshipSqlAdapter,
} from './kernel/index';
import { applyReadScope, resolveNarrowedReadScope, type NarrowedReadScope } from './readScope';
import { probeTenantAuthorizationScope, resolveAuthorizationSubject } from './subject/index';
import type { AuthorizationResourceType } from './bundles/catalog';
import {
  createClientRelationshipSqlAdapter,
  createContactRelationshipSqlAdapter,
} from './clientScopeSqlAdapters';

/**
 * Bundle client-scope narrowing for clients and contacts, compiled into the SQL
 * that produces the rows, so totals, counts and pagination come from the
 * narrowed query. Nothing here filters rows after the query.
 *
 * One context per request: the subject is resolved once (S2 resolver) and its
 * request cache is shared by every narrowing built from it.
 *
 * Fast path: the tenant probe runs first. A tenant with no published bundle
 * assignment and no built-in resolver subject (co-managed seat) has no source that
 * could narrow, so the subject is never resolved, `apply` adds nothing and the query
 * is exactly what it was before — the only statement added is the one probe.
 */

type ClientScopeResource = Extract<AuthorizationResourceType, 'client' | 'contact'>;

// LEVERAGE: pattern resource-sql-narrowing — adapter + rule resolve + compile + fail-closed fallback is the same shape as
// applyTicketReadAuthorizationSql (and assetReadAuthorization); now living in @alga-psa/authorization and shared by
// packages/clients and packages/tickets, the next occurrence of the pattern is the ticket/asset twins — a generic
// per-resource "narrow this query" layer here would absorb all three.
const RESOURCES: Record<
  ClientScopeResource,
  { adapter: (alias: string) => RelationshipSqlAdapter; defaultAlias: string; clientRequired: boolean }
> = {
  client: { adapter: createClientRelationshipSqlAdapter, defaultAlias: 'clients', clientRequired: false },
  // A contact with no client belongs to no client in scope: hidden once any rule narrows.
  contact: { adapter: createContactRelationshipSqlAdapter, defaultAlias: 'contacts', clientRequired: true },
};

export interface ClientScopeNarrowing {
  /** True when a bundle rule or a built-in resolver (a co-managed seat) narrows this resource for the subject. */
  readonly narrowed: boolean;
  /** AND the narrowing predicate onto `query`. A no-op when not narrowed. */
  apply<T extends Knex.QueryBuilder>(query: T): T;
}

export interface ClientScopeContext {
  narrowing(resource: ClientScopeResource, alias?: string): Promise<ClientScopeNarrowing>;
  /**
   * Whether the one row `id` is in scope: an existence query carrying the same
   * compiled predicate as the lists, so a detail read and a list never disagree.
   */
  permits(resource: ClientScopeResource, id: string): Promise<boolean>;
}

// LEVERAGE: pattern resource-read-scope-context — client/contact scope here, tags (tagReadScope) and assets each build a per-request
// context around resolveNarrowedReadScope + applyReadScope; a generic per-resource read-scope context would absorb them.
const UNNARROWED: ClientScopeNarrowing = Object.freeze({ narrowed: false, apply: <T>(query: T) => query });

/** No authorization source applies to this subject (no bundle, no built-in resolver subject): every row is in scope. */
const UNNARROWED_CONTEXT: ClientScopeContext = Object.freeze({
  narrowing: async () => UNNARROWED,
  permits: async () => true,
});

export async function createClientScopeContext(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  requestCache: RequestLocalAuthorizationCache = new RequestLocalAuthorizationCache()
): Promise<ClientScopeContext> {
  // Fast path, one cached probe: only a tenant with neither a published bundle assignment nor a built-in resolver
  // subject (a co-managed seat technician, say) is unrestricted for everyone. A probe that cannot be trusted
  // reports the slow path, so this never skips a source a tenant has.
  const probe = await probeTenantAuthorizationScope(conn, tenant, requestCache);
  if (!probe.publishedAssignments && probe.resolverSubjects === false) return UNNARROWED_CONTEXT;

  // A failed resolution propagates: a subject that cannot be resolved gets no rows. Resolved fresh for each request
  // (never across requests), once for every resource of this one.
  const subject: AuthorizationSubject = await resolveAuthorizationSubject(conn, { tenant, user, requestCache });

  // The evaluator combines the built-in (seat) and bundle rules as an intersection; resolved once per resource.
  const scopes = new Map<ClientScopeResource, Promise<NarrowedReadScope | null>>();

  const context: ClientScopeContext = {
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
      let pending = scopes.get(resource);
      if (!pending) {
        pending = resolveNarrowedReadScope(conn, { tenant, user, resourceType: resource, action: 'read', requestCache, subject });
        scopes.set(resource, pending);
      }
      const scope = await pending;
      if (!scope) return UNNARROWED;

      const adapter = def.adapter(columnAlias);
      return {
        narrowed: true,
        apply(query) {
          query.andWhere(function narrowToScope(this: Knex.QueryBuilder) {
            applyReadScope(this, scope, { resourceType: resource, action: 'read', adapter });
            if (def.clientRequired && adapter.clientColumn) this.whereNotNull(adapter.clientColumn);
          });
          return query;
        },
      };
    },
  };
  return context;
}
