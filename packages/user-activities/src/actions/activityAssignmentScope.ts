/**
 * Shared "on this user's activities list" predicates.
 *
 * The user-activities board and the "can this record be grouped from its detail screen?"
 * check (`isActivityOnUsersListForApi`) must agree on what "on my list" means, so the rule
 * lives here once as knex `where` builders. Closed records are NOT excluded here: closed
 * visibility is a separate list filter (`isClosed`), and group membership survives closing.
 *
 * Callers pass a tenant-scoped `scopedDb` (so the resource sub-queries are structurally
 * tenant-scoped) and the raw knex handle (only used for `raw(1)`).
 */

import type { Knex } from 'knex';
import type { TenantDb } from '@alga-psa/db';

export type OnUsersListPredicate = (this: Knex.QueryBuilder) => void;

/** A ticket is on the user's list when assigned to them, or they are a ticket resource. */
export function whereTicketOnUsersList(
  scopedDb: TenantDb,
  db: Knex | Knex.Transaction,
  userId: string
): OnUsersListPredicate {
  return function () {
    // Tickets directly assigned to the user
    this.where("tickets.assigned_to", userId);

    // Or tickets where the user is an additional resource
    this.orWhereExists(
      scopedDb.table("ticket_resources")
        .select(db.raw(1))
        .whereRaw("ticket_resources.ticket_id = tickets.ticket_id")
        .andWhere(function () {
          this.where("ticket_resources.assigned_to", userId)
            .orWhere("ticket_resources.additional_user_id", userId);
        })
    );
  };
}

/** A project task is on the user's list when assigned to them, or they are a task resource. */
export function whereProjectTaskOnUsersList(
  scopedDb: TenantDb,
  db: Knex | Knex.Transaction,
  userId: string
): OnUsersListPredicate {
  return function () {
    // Tasks directly assigned to the user
    this.where("project_tasks.assigned_to", userId);

    // Or tasks where the user is an additional resource
    this.orWhereExists(
      scopedDb.table("task_resources")
        .select(db.raw(1))
        .whereRaw("task_resources.task_id = project_tasks.task_id")
        .andWhere(function () {
          this.where("task_resources.assigned_to", userId)
            .orWhere("task_resources.additional_user_id", userId);
        })
    );
  };
}
