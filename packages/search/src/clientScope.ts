import type { Knex } from 'knex';
import { resolveRowClients } from '@alga-psa/authorization/kernel';
import type { SearchDoc } from '@alga-psa/types';

/**
 * Where a search document gets its client scope from: a table the tenant table manifest declares
 * as client-owned (`clientKeyed`), and the column of that table that holds the document's object id.
 * The join to the client is the manifest's, not the indexer's.
 */
export interface ClientScopeSource {
  table: string;
  keyColumn: string;
}

/** The object types whose rows carry their client scope from the manifest, and where. */
export const CLIENT_SCOPE_SOURCES = {
  client: { table: 'clients', keyColumn: 'client_id' },
  contact: { table: 'contacts', keyColumn: 'contact_name_id' },
  interaction: { table: 'interactions', keyColumn: 'interaction_id' },
  time_entry: { table: 'time_entries', keyColumn: 'entry_id' },
  // A document has no client column: it reaches clients through its associations (document_entity resolver).
  document: { table: 'document_associations', keyColumn: 'document_id' },
} as const satisfies Record<string, ClientScopeSource>;

export type ClientScopedObjectType = keyof typeof CLIENT_SCOPE_SOURCES;

/**
 * A record has one client scope. A record that reaches no client has none (NULL: strict types hide it
 * from narrowed subjects). A record that reaches several clients (a document linked to tickets of two
 * clients) is ambiguous, and an ambiguous owner is also NULL: no narrowed subject is shown a record
 * that may belong to a client they cannot read.
 */
export function clientScopeFromClients(clientIds: readonly string[]): string | null {
  const distinct = [...new Set(clientIds)];
  return distinct.length === 1 ? distinct[0] : null;
}

/** Resolve client scopes for many records of one type with one manifest-driven bulk lookup. */
export async function resolveClientScopes(
  knex: Knex,
  tenant: string,
  objectType: ClientScopedObjectType,
  objectIds: readonly string[],
): Promise<Map<string, string | null>> {
  const source: ClientScopeSource = CLIENT_SCOPE_SOURCES[objectType];
  const owners = await resolveRowClients(knex, tenant, source.table, source.keyColumn, objectIds);
  return new Map(objectIds.map((id) => [id, clientScopeFromClients(owners.get(id) ?? [])]));
}

/** Set `acl.clientScopeId` on freshly built docs of `objectType`. */
export async function attachClientScopes(
  knex: Knex,
  tenant: string,
  objectType: ClientScopedObjectType,
  docs: SearchDoc[],
): Promise<SearchDoc[]> {
  if (docs.length === 0) return docs;
  const scopes = await resolveClientScopes(knex, tenant, objectType, docs.map((doc) => doc.objectId));
  return docs.map((doc) => ({
    ...doc,
    acl: { ...doc.acl, clientScopeId: scopes.get(doc.objectId) ?? undefined },
  }));
}
