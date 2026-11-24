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

/**
 * `tickets` mapping for the read-authorization SQL compiler. `alias` is the alias the query gives
 * `tickets` (`t` for the ticket list; `tc` for a bundle's child rows). Mirrors the ticket record mapping:
 * a ticket is "assigned" only to its primary `assigned_to`. Tickets expose no client-visibility column,
 * so `client_visible_only` denies, matching the JS kernel.
 *
 * Shared by the ticket list, the public API list and every count that must equal a ticket list.
 */
export function createTicketRelationshipSqlAdapter(alias: string = 't'): RelationshipSqlAdapter {
  return {
    ownerColumn: `${alias}.entered_by`,
    clientColumn: `${alias}.client_id`,
    boardColumn: `${alias}.board_id`,
    contactColumn: `${alias}.contact_name_id`,
    billingProfileColumn: `${alias}.billing_profile_id`,
    watchListColumn: `${alias}.attributes`,
    teamColumn: `${alias}.assigned_team_id`,
    applyAssignedUsers(query, userIds) {
      const normalized = Array.from(
        new Set(userIds.filter((value): value is string => typeof value === 'string' && value.length > 0))
      );
      if (normalized.length === 0) {
        query.whereRaw('1 = 0');
      } else if (normalized.length === 1) {
        query.where(`${alias}.assigned_to`, normalized[0]);
      } else {
        query.whereIn(`${alias}.assigned_to`, normalized);
      }
    },
  };
}
