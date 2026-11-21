import type { Knex } from 'knex';
import {
  polymorphicClientsHook,
  polymorphicUnownedHook,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';
import { resolveClientReadScope, type ClientReadScope } from '@alga-psa/authorization/clientReadScope';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';

/**
 * Physical mapping the shared read-authorization SQL compiler needs for `time_entries`.
 *
 * A time entry has no client column: its client is the client of its work item
 * (`work_item_type` + `work_item_id`), resolved by the S4 `work_item` resolver, so a ticket, a project task
 * and an interaction all reach their client and an unlisted kind (`ad_hoc`, `non_billable_category`) has none.
 *
 * Client scope: an entry is in scope when its work item belongs to an in-scope client. An entry whose work
 * item has NO client is the one case a client set cannot answer; it stays visible to its own user, and only
 * to them. Entries by colleagues on client-less work items stay hidden. The rule is composed here from the
 * two S4 hooks (owned by these clients / owned by none), not written as a work-item CASE.
 *
 * `alias` is how the query names the table (unaliased queries use `time_entries`).
 */
export function createTimeEntryRelationshipSqlAdapter(userId: string, alias: string = 'time_entries'): RelationshipSqlAdapter {
  const ownedByClients = polymorphicClientsHook('time_entries', alias);
  const ownedByNoClient = polymorphicUnownedHook('time_entries', alias);
  return {
    ownerColumn: `${alias}.user_id`,
    applyAssignedUsers(query, userIds) {
      const ids = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0)));
      if (ids.length === 0) query.whereRaw('1 = 0');
      else query.whereIn(`${alias}.user_id`, ids);
    },
    // Also called with no clients: the subject's own client-less entries stay visible, nothing else does.
    applyClients(query, clientIds) {
      query.where(function inScopeOrOwnClientless(this: Knex.QueryBuilder) {
        ownedByClients(this, clientIds);
        this.orWhere(function ownClientless(this: Knex.QueryBuilder) {
          ownedByNoClient(this);
          this.where(`${alias}.user_id`, userId);
        });
      });
    },
  };
}

/** Which time entries this user may read, by client. A no-op (and free) for a user nothing narrows. */
export function resolveTimeEntryReadScope(
  knex: Knex | Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  alias: string = 'time_entries'
): Promise<ClientReadScope> {
  return resolveClientReadScope(knex, {
    tenant,
    user,
    resourceType: 'time_entry',
    createAdapter: (subject) => createTimeEntryRelationshipSqlAdapter(subject.userId, alias),
  });
}
