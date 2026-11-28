import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import {
  RequestLocalAuthorizationCache,
  type AuthorizationRequestCache,
  type AuthorizationSubject,
  type RelationshipSqlAdapter,
} from './kernel/index';
import { probeTenantAuthorizationScope, resolveAuthorizationSubject } from './subject/index';
import { applyReadScope, resolveNarrowedReadScope, type NarrowedReadScope } from './readScope';
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
 * Seat scope and bundle scope are evaluated together by `resolveNarrowedReadScope` / `applyReadScope` (the same
 * evaluator the other read paths use), so a co-managed seat technician is bounded to their arrangement's client
 * whether or not the tenant has any bundle, and a bundle can only narrow that further.
 *
 * Fast path: the tenant probe runs first. A tenant with neither a published bundle assignment nor a built-in
 * resolver subject has nothing that could narrow, so the subject is never resolved, `apply` adds nothing and the
 * query is exactly what it was before — the only statement added is the one probe.
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
  /** True when the subject's seat or a bundle narrows this resource (a closed baseline that names neither included). */
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

const UNNARROWED: ClientScopeNarrowing = Object.freeze({ narrowed: false, apply: <T>(query: T) => query });

/** Nothing can narrow in this tenant: no bundle assignment and no built-in resolver subject. Every row is in scope. */
const UNNARROWED_CONTEXT: ClientScopeContext = Object.freeze({
  narrowing: async () => UNNARROWED,
  permits: async () => true,
});

export async function createClientScopeContext(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  requestCache: AuthorizationRequestCache = new RequestLocalAuthorizationCache()
): Promise<ClientScopeContext> {
  // The eager tenant probe, cached on the request. A probe that cannot be trusted reports the slow path, so this
  // never skips a source a tenant has. A tenant with neither published bundle assignments nor a built-in resolver
  // subject (a co-managed seat technician, say) has nothing that can narrow: the one probe is the only statement.
  const tenantScope = await probeTenantAuthorizationScope(conn, tenant, requestCache);
  if (!tenantScope.publishedAssignments && tenantScope.resolverSubjects === false) return UNNARROWED_CONTEXT;

  // The subject is resolved lazily, once per request, and shared by every resource through the request cache.
  // A failed resolution propagates: a subject that cannot be resolved gets no rows.
  let subjectPending: Promise<AuthorizationSubject> | undefined;
  const subjectOnce = (): Promise<AuthorizationSubject> => {
    subjectPending ??= requestCache.getOrLoad(`authorization:client-scope-subject:${tenant}:${user.user_id}`, () =>
      resolveAuthorizationSubject(conn, { tenant, user, requestCache })
    );
    return subjectPending;
  };

  // Seat and bundle scope are evaluated together by the shared read-scope evaluator, once per resource per request.
  const scopeByResource = new Map<ClientScopeResource, Promise<NarrowedReadScope | null>>();
  const scopeOf = (resource: ClientScopeResource) => {
    let pending = scopeByResource.get(resource);
    if (!pending) {
      pending = subjectOnce().then((subject) =>
        resolveNarrowedReadScope(conn, { tenant, user, resourceType: resource, action: 'read', requestCache, subject })
      );
      scopeByResource.set(resource, pending);
    }
    return pending;
  };

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
      const scope = await scopeOf(resource);
      if (!scope) return UNNARROWED;

      const adapter = def.adapter(alias ?? def.defaultAlias);
      return {
        narrowed: true,
        apply(query) {
          query.andWhere(function narrowToScope(this: Knex.QueryBuilder) {
            // An unsupported policy denies every row inside applyReadScope; it never widens the answer.
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
