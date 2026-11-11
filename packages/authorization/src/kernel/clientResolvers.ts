import type { Knex } from 'knex';
import { tenantClientOwnership } from '@alga-psa/db/tenantTableManifest';
import type { DiscriminatorClientResolver } from './clientPath';
import { BUILTIN_CLIENT_RESOLVERS } from './builtinClientResolvers';

// ---------------------------------------------------------------------------
// Client resolvers for polymorphic tables.
//
// time_entries, schedule_entries, document_associations and tag_mappings have no
// client column: a row carries a (discriminator, id) pair and the client is a
// property of the record that pair points at. The tenant table manifest names the
// resolver for each table (`clientKeyed: { by: 'resolver', resolver, ... }`); this
// registry holds what each resolver does, one entry per discriminator value.
//
// Each entry carries both facets (see clientPath.ts), so a kind can never be
// registered with only one. A discriminator value nobody registered has no client:
// the row facet returns null and the SQL facet matches nothing (fail closed).
// ---------------------------------------------------------------------------

/** Entries of one resolver, keyed by discriminator value. */
export type ClientResolverEntries = Readonly<Record<string, DiscriminatorClientResolver>>;

/** Where the polymorphic row's columns are in the query being narrowed. */
export interface PolymorphicRowColumns {
  tenantRef: string;
  discriminatorRef: string;
  idRef: string;
}

export interface ClientResolverRegistry {
  /** Add entries to a resolver. A discriminator that is already registered is an error, never an overwrite. */
  register(resolver: string, entries: ClientResolverEntries): void;
  has(resolver: string, discriminator: string): boolean;
  /** Row facet. Unknown resolver or discriminator resolves to null. */
  resolveClient(
    db: Knex | Knex.Transaction,
    tenant: string,
    resolver: string,
    discriminator: string,
    id: string
  ): Promise<string | null>;
  /** SQL facet. Narrows `builder` to rows owned by `clientIds`; matches nothing for an empty set or unknown resolver. */
  applyClients(
    builder: Knex.QueryBuilder,
    resolver: string,
    columns: PolymorphicRowColumns,
    clientIds: readonly string[]
  ): void;
  /**
   * SQL facet. Narrows `builder` to rows that have NO client: every registered kind either does not match the
   * row's discriminator or points at a record with no client (or no record). The complement of "owned by any
   * client", so it is exactly the rows `resolveClient` answers null for. An unknown resolver owns nothing, so
   * every row is unowned. Whoever composes this decides who may see such rows; it never grants anything alone.
   */
  applyUnowned(builder: Knex.QueryBuilder, resolver: string, columns: PolymorphicRowColumns): void;
}

export function createClientResolverRegistry(
  initial: Readonly<Record<string, ClientResolverEntries>> = {}
): ClientResolverRegistry {
  const resolvers = new Map<string, Map<string, DiscriminatorClientResolver>>();

  const registry: ClientResolverRegistry = {
    register(resolver, entries) {
      const target = resolvers.get(resolver) ?? new Map<string, DiscriminatorClientResolver>();
      for (const [discriminator, entry] of Object.entries(entries)) {
        if (target.has(discriminator)) {
          throw new Error(`Client resolver '${resolver}' already has an entry for '${discriminator}'`);
        }
        target.set(discriminator, entry);
      }
      resolvers.set(resolver, target);
    },
    has: (resolver, discriminator) => resolvers.get(resolver)?.has(discriminator) ?? false,
    async resolveClient(db, tenant, resolver, discriminator, id) {
      const entry = resolvers.get(resolver)?.get(discriminator);
      return entry ? entry.resolveClient(db, tenant, id) : null;
    },
    applyClients(builder, resolver, columns, clientIds) {
      const entries = resolvers.get(resolver);
      if (!entries || entries.size === 0 || clientIds.length === 0) {
        builder.whereRaw('1 = 0');
        return;
      }
      builder.where(function anyKnownKind(this: Knex.QueryBuilder) {
        for (const [discriminator, entry] of entries) {
          this.orWhere(function oneKind(this: Knex.QueryBuilder) {
            this.where(columns.discriminatorRef, discriminator).whereExists(function ownedByClients(this: Knex.QueryBuilder) {
              entry.narrowToClients(this, { tenantRef: columns.tenantRef, idRef: columns.idRef }, clientIds);
            });
          });
        }
      });
    },
    applyUnowned(builder, resolver, columns) {
      const entries = resolvers.get(resolver);
      if (!entries || entries.size === 0) return;
      builder.where(function noKnownKindOwnsIt(this: Knex.QueryBuilder) {
        for (const [discriminator, entry] of entries) {
          this.whereNot(function ownedByAnyClient(this: Knex.QueryBuilder) {
            this.where(columns.discriminatorRef, discriminator).whereExists(function hasClient(this: Knex.QueryBuilder) {
              entry.narrowToOwned(this, { tenantRef: columns.tenantRef, idRef: columns.idRef });
            });
          });
        }
      });
    },
  };

  for (const [resolver, entries] of Object.entries(initial)) registry.register(resolver, entries);
  return registry;
}

/** The process-wide registry, seeded with the built-in resolvers. Packages that own further kinds register on it. */
export const clientResolvers: ClientResolverRegistry = createClientResolverRegistry(BUILTIN_CLIENT_RESOLVERS);

/**
 * Build the `RelationshipSqlAdapter.applyClients` hook for a polymorphic table from
 * its manifest declaration:
 *
 *   adapter = { ..., applyClients: polymorphicClientsHook('time_entries', 'te') }
 *
 * Throws at construction when the table is not declared as resolver-owned, so a
 * wrong table name is caught when the adapter is built, not when a user is denied.
 */
export function polymorphicClientsHook(
  table: string,
  alias: string,
  registry: ClientResolverRegistry = clientResolvers
): (builder: Knex.QueryBuilder, clientIds: string[]) => void {
  const { resolver, columns } = resolverOwnership(table, alias);
  return (builder, clientIds) => registry.applyClients(builder, resolver, columns, clientIds);
}

/**
 * The complement of `polymorphicClientsHook`: narrows to the table's rows that have no client.
 * A resource whose policy lets someone see their own client-less rows composes it:
 *
 *   builder.where(function () { clients(this, ids); this.orWhere(function () { unowned(this); this.where('te.user_id', me); }); })
 */
export function polymorphicUnownedHook(
  table: string,
  alias: string,
  registry: ClientResolverRegistry = clientResolvers
): (builder: Knex.QueryBuilder) => void {
  const { resolver, columns } = resolverOwnership(table, alias);
  return (builder) => registry.applyUnowned(builder, resolver, columns);
}

function resolverOwnership(table: string, alias: string): { resolver: string; columns: PolymorphicRowColumns } {
  const ownership = tenantClientOwnership(table);
  if (!ownership || ownership.by !== 'resolver') {
    throw new Error(`Table '${table}' is not declared as client-owned by a resolver in the tenant table manifest`);
  }
  return {
    resolver: ownership.resolver,
    columns: {
      tenantRef: `${alias}.tenant`,
      discriminatorRef: `${alias}.${ownership.discriminator}`,
      idRef: `${alias}.${ownership.id}`,
    },
  };
}
