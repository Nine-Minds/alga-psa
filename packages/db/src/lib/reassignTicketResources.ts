import type { Knex } from 'knex';
import { tenantDb } from './tenantDb';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

/**
 * Re-keys a ticket's additional agents when the primary assignee changes.
 *
 * `ticket_resources` has a foreign key on (tenant, ticket_id, assigned_to) with
 * NO ACTION semantics, so `tickets.assigned_to` cannot be updated while rows
 * reference the old assignee. Call this before the update, then invoke the
 * returned finalizer afterwards to re-insert against the new assignee. Shared by
 * the server action and the REST API so both paths behave the same.
 */
export async function prepareTicketResourceReassignment(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  currentAssignedTo: string | null | undefined,
  newAssignedTo: string | null | undefined
): Promise<() => Promise<void>> {
  const noop = async () => {};

  // The incoming primary assignee may already be an additional agent, which the
  // `assigned_to != additional_user_id` check constraint forbids. Absorb that
  // row into the promotion rather than failing the update.
  if (newAssignedTo) {
    await tenantScopedTable(trx, 'ticket_resources', tenant)
      .where({ ticket_id: ticketId, additional_user_id: newAssignedTo })
      .delete();
  }

  if (!currentAssignedTo) {
    return noop;
  }

  const existingResources = await tenantScopedTable(trx, 'ticket_resources', tenant)
    .where({ ticket_id: ticketId, assigned_to: currentAssignedTo })
    .select('*');

  if (existingResources.length === 0) {
    return noop;
  }

  const resourcesToRecreate: Record<string, unknown>[] = existingResources
    .filter((resource: Record<string, unknown>) => resource.additional_user_id !== newAssignedTo)
    .map(({ assignment_id: _assignmentId, ...resource }: Record<string, unknown>) => resource);

  await tenantScopedTable(trx, 'ticket_resources', tenant)
    .where({ ticket_id: ticketId, assigned_to: currentAssignedTo })
    .delete();

  return async () => {
    // Unassigning leaves nothing to key the rows to (`assigned_to` is NOT NULL),
    // so the additional agents go away with the assignment.
    if (!newAssignedTo || resourcesToRecreate.length === 0) {
      return;
    }

    await tenantScopedTable(trx, 'ticket_resources', tenant).insert(
      resourcesToRecreate.map((resource) => ({ ...resource, assigned_to: newAssignedTo }))
    );
  };
}
