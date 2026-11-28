import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import {
  RequestLocalAuthorizationCache,
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
 * Read scope for clients and contacts, compiled into the SQL that produces the rows, so totals, counts, pagination
 * and lookup by id come from the narrowed query. Nothing here filters rows after the query.
 *
 * The scope is the one `readScope.ts` computes for every resource: the subject's built-in resolver rules (a
 * co-managed seat technician's own client, say) ANDed with every applicable bundle rule. A seat boundary therefore
 * holds whether or not the tenant has published a bundle, and a bundle can only narrow it further.
 *
 * One context per request: the subject is resolved once, lazily, and shared by the client and the contact scope.
 *
 * Fast path: the tenant probe runs first. A tenant with no published bundle assignment and no subject of a built-in
 * resolver has nothing that could narrow, so the subject is never resolved, `apply` adds nothing and the query is
 * exactly what it was before — the only statement added is the one probe.
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
  /** True when a built-in resolver rule (a seat boundary) or a bundle rule narrows this resource for the subject. */
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

export async function createClientScopeContext(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  requestCache: RequestLocalAuthorizationCache = new RequestLocalAuthorizationCache()
): Promise<ClientScopeContext> {
  // The tenant probe runs here, once; every scope below reads it from the request cache. A probe that cannot be
  // trusted reports the slow path, so this never skips rules or resolvers a tenant has.
  await probeTenantAuthorizationScope(conn, tenant, requestCache);

  // One subject per request, loaded the first time a resource's scope is not on the fast path. A failed resolution
  // propagates: a subject that cannot be resolved gets no rows.
  let subject: Promise<AuthorizationSubject> | undefined;
  const resolveSubject = () => (subject ??= resolveAuthorizationSubject(conn, { tenant, user, requestCache }));

  // The scope is resolved once per resource per request.
  const scopes = new Map<ClientScopeResource, Promise<NarrowedReadScope | null>>();
  const scopeOf = (resource: ClientScopeResource) => {
    let pending = scopes.get(resource);
    if (!pending) {
      pending = resolveNarrowedReadScope(conn, { tenant, user, resourceType: resource, requestCache, resolveSubject });
      scopes.set(resource, pending);
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
      const scope = await scopeOf(resource);
      if (!scope) return UNNARROWED;

      const def = RESOURCES[resource];
      const adapter = def.adapter(alias ?? def.defaultAlias);
      return {
        narrowed: true,
        apply(query) {
          query.andWhere(function narrowToScope(this: Knex.QueryBuilder) {
            // A policy the compiler cannot express denies every row: it must not widen the answer.
            applyReadScope(this, scope, { resourceType: resource, adapter });
            if (def.clientRequired && adapter.clientColumn) this.whereNotNull(adapter.clientColumn);
          });
          return query;
        },
      };
    },
  };
  return context;
}
