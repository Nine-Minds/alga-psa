import type { Knex } from 'knex';
import { tenantClientOwnership } from '@alga-psa/db';
import type { ClientOwnership, ClientOwnershipChain } from '@alga-psa/db/tenantTableManifest';
import {
  polymorphicClientsHook,
  polymorphicUnownedHook,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';

/**
 * Turns a table's client-ownership declaration (the S3 manifest) into the physical mapping the shared
 * read-authorization SQL compiler needs, so a report narrows a table the same way a list does.
 *
 *   column        -> `clientColumn`, compiled to `alias.column IN (in-scope clients)`
 *   parent chain  -> `applyClients`, a correlated EXISTS along the chain (1 to 3 hops, tenant-joined at every hop)
 *   alternatives  -> `applyClients`; a row follows the parents it has a value for, and EVERY such parent must be in
 *                    scope (the strict reading; a row with no parent value at all is not owned by anyone and is hidden)
 *   resolver      -> `applyClients` through the S4 polymorphic resolver for the table
 *   exempt        -> not client-owned; never a predicate target
 *   (no entry)    -> undeclared; nothing says how to narrow it
 *
 * Whatever the client set, an empty set matches nothing.
 */

export type TableOwnershipKind = 'owned' | 'exempt' | 'undeclared';

export function classifyTableOwnership(table: string): TableOwnershipKind {
  const ownership = tenantClientOwnership(table);
  if (!ownership) return 'undeclared';
  return ownership.by === 'exempt' ? 'exempt' : 'owned';
}

// LEVERAGE: pattern own-clientless-resolver-rows — S10's time-entry adapter says "a client-less work item's entry stays
// visible to its own user"; the report layer restates that one fact per table because the manifest cannot carry it.
// A manifest-level "rows with no client belong to <column>" would let the list adapter and this one share it.
const OWN_CLIENTLESS_ROWS: Readonly<Record<string, string>> = { time_entries: 'user_id' };

const deny = (builder: Knex.QueryBuilder) => void builder.whereRaw('1 = 0');

let chainAliasSeq = 0;

function ownedClientColumn(table: string): string {
  const ownership = tenantClientOwnership(table);
  if (ownership?.by !== 'column') {
    throw new Error(`Table ${table} ends a client-ownership chain but declares no client column`);
  }
  return ownership.column;
}

/** Adds "the row at `outer` reaches one of `clientIds` along `chain`" to `builder`. */
function chainReachesClients(
  builder: Knex.QueryBuilder,
  outer: string,
  chain: ClientOwnershipChain,
  clientIds: readonly string[]
): void {
  const last = chain[chain.length - 1];
  const landsOnClients = last.table === 'clients';
  // A hop that lands on `clients` needs no join: the referencing column already is the client id.
  const joined = landsOnClients ? chain.slice(0, -1) : chain;
  if (joined.length === 0) {
    builder.whereIn(`${outer}.${last.column}`, [...clientIds]);
    return;
  }
  const seq = ++chainAliasSeq;
  const alias = (index: number) => `cs${seq}_${index}`;
  builder.whereExists(function chainInScope(this: Knex.QueryBuilder) {
    const first = joined[0];
    this.select(this.client.raw('1'))
      .from(`${first.table} as ${alias(0)}`)
      .whereRaw('?? = ??', [`${alias(0)}.tenant`, `${outer}.tenant`])
      .whereRaw('?? = ??', [`${alias(0)}.${first.parentColumn ?? first.column}`, `${outer}.${first.column}`]);
    for (let index = 1; index < joined.length; index += 1) {
      const hop = joined[index];
      this.join(`${hop.table} as ${alias(index)}`, function onHop(this: Knex.JoinClause) {
        this.on(`${alias(index)}.tenant`, `${alias(index - 1)}.tenant`).andOn(
          `${alias(index)}.${hop.parentColumn ?? hop.column}`,
          `${alias(index - 1)}.${hop.column}`
        );
      });
    }
    const clientRef = landsOnClients
      ? `${alias(joined.length - 1)}.${last.column}`
      : `${alias(joined.length - 1)}.${ownedClientColumn(last.table)}`;
    this.whereIn(clientRef, [...clientIds]);
  });
}

function applyClientsAdapter(
  applyClients: (builder: Knex.QueryBuilder, clientIds: string[]) => void
): RelationshipSqlAdapter {
  // The owner/assignee templates (`own`, `assigned`, `managed`) mean nothing for a report's client narrowing; they deny.
  return { applyAssignedUsers: deny, applyClients };
}

function adapterFor(ownership: Exclude<ClientOwnership, { by: 'exempt' }>, table: string, alias: string, userId: string | null): RelationshipSqlAdapter {
  switch (ownership.by) {
    case 'column':
      return { clientColumn: `${alias}.${ownership.column}`, applyAssignedUsers: deny };
    case 'parent':
      return applyClientsAdapter((builder, ids) => {
        if (ids.length === 0) return deny(builder);
        chainReachesClients(builder, alias, ownership.chain, ids);
      });
    case 'alternatives':
      return applyClientsAdapter((builder, ids) => {
        if (ids.length === 0) return deny(builder);
        builder.where(function everyParentInScope(this: Knex.QueryBuilder) {
          this.where(function someParentHasAValue(this: Knex.QueryBuilder) {
            for (const chain of ownership.parents) this.orWhereNotNull(`${alias}.${chain[0].column}`);
          });
          for (const chain of ownership.parents) {
            this.where(function absentOrInScope(this: Knex.QueryBuilder) {
              this.whereNull(`${alias}.${chain[0].column}`).orWhere(function inScope(this: Knex.QueryBuilder) {
                chainReachesClients(this, alias, chain, ids);
              });
            });
          }
        });
      });
    case 'resolver': {
      const ownedByClients = polymorphicClientsHook(table, alias);
      const ownerColumn = OWN_CLIENTLESS_ROWS[table];
      if (!ownerColumn) return applyClientsAdapter(ownedByClients);
      const ownedByNoClient = polymorphicUnownedHook(table, alias);
      return applyClientsAdapter((builder, ids) => {
        builder.where(function inScopeOrOwnClientless(this: Knex.QueryBuilder) {
          ownedByClients(this, ids);
          this.orWhere(function ownClientless(this: Knex.QueryBuilder) {
            ownedByNoClient(this);
            if (userId) this.where(`${alias}.${ownerColumn}`, userId);
            else deny(this);
          });
        });
      });
    }
  }
}

/**
 * The mapping for `table` as named in a query under `alias`. Caller guarantees `classifyTableOwnership(table) === 'owned'`;
 * a table that is not owned has no mapping and this throws (a bug in the caller, never a silent no-op).
 */
export function createClientOwnershipAdapter(table: string, alias: string, userId: string | null): RelationshipSqlAdapter {
  const ownership = tenantClientOwnership(table);
  if (!ownership || ownership.by === 'exempt') {
    throw new Error(`Table ${table} is not client-owned; it has no client predicate`);
  }
  return adapterFor(ownership, table, alias, userId);
}
