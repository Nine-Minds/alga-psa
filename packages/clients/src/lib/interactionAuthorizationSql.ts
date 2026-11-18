import type { Knex } from 'knex';
import type { RelationshipSqlAdapter } from '@alga-psa/authorization/kernel';
import { resolveClientReadScope, type ClientReadScope } from '@alga-psa/authorization/clientReadScope';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';

/**
 * Physical mapping the shared read-authorization SQL compiler needs for the `interactions` table.
 * `interactions.client_id` is nullable: a null-client interaction matches no client, so a
 * client-restricted subject never sees it (Open question 3: no-client interactions are hidden by default).
 *
 * `alias` is how the query names the table: the interaction queries use both `interactions` and `i`.
 */
export function createInteractionRelationshipSqlAdapter(alias: string = 'interactions'): RelationshipSqlAdapter {
  return {
    ownerColumn: `${alias}.user_id`,
    clientColumn: `${alias}.client_id`,
    applyAssignedUsers(query, userIds) {
      const ids = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0)));
      if (ids.length === 0) query.whereRaw('1 = 0');
      else query.whereIn(`${alias}.user_id`, ids);
    },
  };
}

/** Which interactions this user may read, by client. A no-op (and free) for a user nothing narrows. */
export function resolveInteractionReadScope(
  knex: Knex | Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  alias: string = 'interactions'
): Promise<ClientReadScope> {
  return resolveClientReadScope(knex, {
    tenant,
    user,
    resourceType: 'interaction',
    createAdapter: () => createInteractionRelationshipSqlAdapter(alias),
  });
}
