import type { RelationshipSqlAdapter } from './kernel/index';
import { tenantClientOwnership } from '@alga-psa/db/tenantTableManifest';

/**
 * Physical mappings the shared read-authorization SQL compiler needs for the
 * `clients` and `contacts` tables. The client column comes from the table's
 * ownership declaration in the tenant table manifest rather than a literal name.
 *
 * Neither table has a scalar owner or a "assigned to" relation that the
 * `own`/`assigned`/`managed` templates mean (`clients.account_manager_id` is an
 * account manager, not an owner), so those templates deny: narrower, fail-closed.
 */

function declaredClientColumn(table: 'clients' | 'contacts'): string {
  const ownership = tenantClientOwnership(table);
  if (ownership?.by !== 'column') {
    throw new Error(`Table ${table} must declare a client column for read authorization`);
  }
  return ownership.column;
}

function createClientColumnAdapter(table: 'clients' | 'contacts', alias: string): RelationshipSqlAdapter {
  return {
    clientColumn: `${alias}.${declaredClientColumn(table)}`,
    // No client-visibility column ⇒ `client_visible_only` denies.
    applyAssignedUsers(query) {
      query.whereRaw('1 = 0');
    },
  };
}

/** `alias` is the alias the query gives `clients`. */
export function createClientRelationshipSqlAdapter(alias: string = 'clients'): RelationshipSqlAdapter {
  return createClientColumnAdapter('clients', alias);
}

/**
 * `contacts.client_id` is nullable. A NULL never equals a value in scope, so a
 * client-less contact fails every client-based template; the contact scope also
 * excludes NULL explicitly whenever a rule narrows (see `clientScopeAuthorization`).
 */
export function createContactRelationshipSqlAdapter(alias: string = 'contacts'): RelationshipSqlAdapter {
  return createClientColumnAdapter('contacts', alias);
}
