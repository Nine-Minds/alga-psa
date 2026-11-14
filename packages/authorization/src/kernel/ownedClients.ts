import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db/tenantDb';
import { tenantClientOwnership } from '@alga-psa/db/tenantTableManifest';
import { clientResolvers, type ClientResolverRegistry } from './clientResolvers';

// ---------------------------------------------------------------------------
// Row -> client, driven by the tenant table manifest.
//
// The manifest says how a row of each table reaches a client (`clientKeyed`): a named column
// or a registered resolver for polymorphic tables. This reads that declaration, so a reader
// that needs "which client owns this row" (search indexers, a re-index job) states the table
// and its key column and never writes the join itself.
//
// A row may own more than one client (a document linked to several records), so the answer
// is a set per key; the caller decides what several means.
// ---------------------------------------------------------------------------

/**
 * The clients that own the rows of `table` whose `keyColumn` is in `keys`.
 *
 * Every key is present in the result; a key with no row, or a row with no client, maps to an
 * empty array. `keyColumn` need not be unique: for a child table keyed by its parent
 * (document_associations by document_id) the set is the union over the child rows.
 *
 * Supports `column` and `resolver` declarations. Any other declaration (parent chains,
 * alternatives, exemptions) is an error rather than a guess: the first reader that needs one
 * extends this function.
 */
export async function resolveRowClients(
  db: Knex | Knex.Transaction,
  tenant: string,
  table: string,
  keyColumn: string,
  keys: readonly string[],
  registry: ClientResolverRegistry = clientResolvers
): Promise<Map<string, string[]>> {
  const owners = new Map<string, Set<string>>();
  const wanted = [...new Set(keys.filter(Boolean))];
  for (const key of wanted) owners.set(key, new Set());
  if (wanted.length === 0) return new Map();

  const ownership = tenantClientOwnership(table);
  if (!ownership) throw new Error(`Table '${table}' has no client ownership declaration in the tenant table manifest`);
  const scoped = tenantDb(db, tenant);

  if (ownership.by === 'column') {
    const rows = await scoped
      .table(table)
      .whereIn(keyColumn, wanted)
      .select<Array<Record<string, string | null>>>({ key: keyColumn, client_id: ownership.column });
    for (const row of rows) if (row.client_id) owners.get(String(row.key))?.add(row.client_id);
  } else if (ownership.by === 'resolver') {
    const rows = await scoped
      .table(table)
      .whereIn(keyColumn, wanted)
      .select<Array<Record<string, string | null>>>({
        key: keyColumn,
        discriminator: ownership.discriminator,
        id: ownership.id,
      });
    const idsByKind = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.discriminator || !row.id) continue;
      const ids = idsByKind.get(row.discriminator) ?? new Set<string>();
      ids.add(String(row.id));
      idsByKind.set(row.discriminator, ids);
    }
    const clientByKindAndId = new Map<string, string | null>();
    for (const [kind, ids] of idsByKind) {
      const resolved = await registry.resolveClients(db, tenant, ownership.resolver, kind, [...ids]);
      for (const [id, clientId] of resolved) clientByKindAndId.set(`${kind}\u0000${id}`, clientId);
    }
    for (const row of rows) {
      const clientId = clientByKindAndId.get(`${row.discriminator}\u0000${row.id}`);
      if (clientId) owners.get(String(row.key))?.add(clientId);
    }
  } else {
    throw new Error(`Table '${table}' is declared client-owned by '${ownership.by}'; resolveRowClients reads 'column' and 'resolver' declarations`);
  }

  return new Map([...owners].map(([key, clients]) => [key, [...clients].sort()]));
}
