import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// Client paths: how a record of one kind reaches its client.
//
// A polymorphic table (time_entries, tag_mappings, ...) points at records of
// several kinds with a (discriminator, id) pair. For each kind the question is
// "which client owns the record the id points at?". A `ClientPath` states that
// once, as data: the table the id lands on, zero or more parent hops, and the
// column on the last table that holds the client.
//
// Both facets are DERIVED from the one declaration, so they cannot drift:
//   - resolveClient(): the row facet, one query for one id;
//   - narrowToClients(): the SQL facet, a correlated EXISTS body.
// Every hop joins on `tenant` as well as the key (Citus co-location, and no
// cross-tenant match is possible even for a forged id).
// ---------------------------------------------------------------------------

/** One step from a table to a parent that is closer to the client. */
export interface ClientPathHop {
  /** Column on the table the hop starts from. */
  column: string;
  /** Parent table the hop lands on. */
  table: string;
  /** Parent column that `column` matches. */
  parentColumn: string;
}

export interface ClientPath {
  /** The table an id of this kind lands on. */
  table: string;
  /** The column of `table` that holds the id. */
  idColumn: string;
  /** Hops from `table` toward the client; empty when `table` itself carries the client. */
  via?: readonly ClientPathHop[];
  /** Column of the LAST table on the path that holds the client id. */
  clientColumn: string;
}

/** Where, in the outer (polymorphic) query, the SQL facet finds the row's tenant and id. */
export interface PolymorphicRowRefs {
  tenantRef: string;
  idRef: string;
}

/** Both facets for one discriminator value of one resolver. */
export interface DiscriminatorClientResolver {
  /** Row facet: the client that owns record `id`, or null when it has none or does not exist. */
  resolveClient(db: Knex | Knex.Transaction, tenant: string, id: string): Promise<string | null>;
  /**
   * SQL facet: fill `subquery` (the body of an `EXISTS`) so that it matches only
   * when the record the outer row points at belongs to one of `clientIds`.
   */
  narrowToClients(subquery: Knex.QueryBuilder, refs: PolymorphicRowRefs, clientIds: readonly string[]): void;
  /**
   * SQL facet: fill `subquery` (the body of an `EXISTS`) so that it matches when the record the outer row
   * points at has A client, any client. Negated, this is "the row has no client": the row facet's null.
   */
  narrowToOwned(subquery: Knex.QueryBuilder, refs: PolymorphicRowRefs): void;
}

function joinPath(query: Knex.QueryBuilder, path: ClientPath): string {
  let previous = 'p0';
  (path.via ?? []).forEach((hop, index) => {
    const alias = `p${index + 1}`;
    query.join(`${hop.table} as ${alias}`, function onHop(this: Knex.JoinClause) {
      this.on(`${alias}.tenant`, `${previous}.tenant`).andOn(`${alias}.${hop.parentColumn}`, `${previous}.${hop.column}`);
    });
    previous = alias;
  });
  return previous;
}

/** The shared body of both SQL facets: the record the outer row points at, joined along the path. Returns the last alias. */
function pointedAt(subquery: Knex.QueryBuilder, path: ClientPath, refs: PolymorphicRowRefs): string {
  subquery.from(`${path.table} as p0`).select('p0.tenant');
  const last = joinPath(subquery, path);
  subquery
    .whereRaw('?? = ??', ['p0.tenant', refs.tenantRef])
    .whereRaw('?? = ??', [`p0.${path.idColumn}`, refs.idRef]);
  return last;
}

/** Build both facets from one path declaration. */
export function clientPath(path: ClientPath): DiscriminatorClientResolver {
  return {
    async resolveClient(db, tenant, id) {
      if (!id) return null;
      const query = db.queryBuilder().from(`${path.table} as p0`);
      const last = joinPath(query, path);
      const row = await query
        .where('p0.tenant', tenant)
        .where(`p0.${path.idColumn}`, id)
        .first<{ client_id: string | null } | undefined>({ client_id: `${last}.${path.clientColumn}` });
      return row?.client_id ?? null;
    },
    narrowToClients(subquery, refs, clientIds) {
      const last = pointedAt(subquery, path, refs);
      subquery.whereIn(`${last}.${path.clientColumn}`, [...clientIds]);
    },
    narrowToOwned(subquery, refs) {
      const last = pointedAt(subquery, path, refs);
      subquery.whereNotNull(`${last}.${path.clientColumn}`);
    },
  };
}
