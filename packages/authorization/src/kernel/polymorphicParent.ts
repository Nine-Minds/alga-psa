import type { Knex } from 'knex';
import { polymorphicClientsHook, clientResolvers, type ClientResolverRegistry } from './clientResolvers';

// ---------------------------------------------------------------------------
// A parent row is visible when SOME child polymorphic row resolves to an in-scope client.
//
// Documents (document_associations) and tag definitions (tag_mappings) share this shape:
// the parent carries no client of its own, its children each point at a record of some
// kind, and the parent may be read when any one of those records belongs to a client the
// subject may see ("any client" semantics, PRD Open Question 1).
//
// This is a thin layer over `polymorphicClientsHook`: the hook narrows the child table to
// rows owned by a client set, and this wraps it in the correlated EXISTS that lifts the
// answer to the parent. The result has the `RelationshipSqlAdapter.applyClients` shape, so
// a resource plugs it into the shared read compiler and every client template
// (selected_clients, client_portfolio, same_client) works for it with no further code.
//
// Fail closed: an empty client set matches nothing, a child kind nobody registered a
// resolver for matches nothing (the registry's rule), and a parent with no children has
// no client at all.
// ---------------------------------------------------------------------------

/** The polymorphic child table and the column by which it points at its parent. */
export interface PolymorphicChild {
  /** A table the tenant manifest declares as resolver-owned (document_associations, tag_mappings). */
  table: string;
  /** Child column that holds the parent's key (document_id, tag_id). */
  parentKeyColumn: string;
  /** Alias the child gets inside the EXISTS. Must not collide with the outer query's aliases. */
  alias?: string;
}

/** Where the parent's tenant and key are in the outer query. */
export interface ParentRefs {
  tenantRef: string;
  keyRef: string;
}

export function parentVisibleViaChildClients(
  child: PolymorphicChild,
  parent: ParentRefs,
  registry: ClientResolverRegistry = clientResolvers
): (builder: Knex.QueryBuilder, clientIds: string[]) => void {
  const alias = child.alias ?? `${child.table}_scope`;
  // Throws now, at construction, when `table` is not declared resolver-owned.
  const narrowChild = polymorphicClientsHook(child.table, alias, registry);

  return (builder, clientIds) => {
    if (clientIds.length === 0) {
      builder.whereRaw('1 = 0');
      return;
    }
    builder.whereExists(function someChildInScope(this: Knex.QueryBuilder) {
      this.select(this.client.raw('1'))
        .from(`${child.table} as ${alias}`)
        .whereRaw('?? = ??', [`${alias}.tenant`, parent.tenantRef])
        .whereRaw('?? = ??', [`${alias}.${child.parentKeyColumn}`, parent.keyRef]);
      narrowChild(this, clientIds);
    });
  };
}
