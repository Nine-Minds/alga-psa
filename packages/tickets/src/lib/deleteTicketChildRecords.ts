import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { deleteEntityTags } from '@alga-psa/tags/lib/tagCleanup';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

/**
 * Deletes (or detaches) every child row that references a ticket, so the ticket
 * itself can be removed without tripping a foreign key constraint.
 *
 * CitusDB does not support ON DELETE CASCADE, so each dependent table has to be
 * cleaned up explicitly. This is the single source of truth for that cleanup so
 * the server-action delete path (`performTicketDelete`) and the REST API delete
 * path (`TicketService.delete`) stay in sync — they previously drifted, which is
 * how `ticket_audit_logs` ended up blocking deletes.
 *
 * Callers are responsible for the final `tickets` delete (and any event/analytics
 * side effects) after this resolves.
 */
export async function deleteTicketChildRecords(
  trx: Knex.Transaction,
  ticketId: string,
  tenant: string,
  ticket: { ticket_number?: string | null }
): Promise<void> {
  await deleteEntityTags(trx, ticketId, 'ticket');

  // Delete comment reactions before comments (CitusDB doesn't support ON DELETE CASCADE)
  const commentIds = await tenantScopedTable(trx, 'comments', tenant)
    .where({ ticket_id: ticketId })
    .pluck('comment_id');
  if (commentIds.length > 0) {
    await tenantScopedTable(trx, 'comment_reactions', tenant)
      .whereIn('comment_id', commentIds)
      .delete();
  }

  // Delete email reply tokens before comments. email_reply_tokens has a
  // non-cascading FK to comments (tenant, comment_id), so any token referencing
  // one of this ticket's comments must be removed first or the comments delete
  // below trips the constraint. Match on comment_id as well as ticket_id to
  // catch tokens whose ticket_id is null/stale but still point at a comment.
  await tenantScopedTable(trx, 'email_reply_tokens', tenant)
    .where((builder: Knex.QueryBuilder) => {
      builder.where('ticket_id', ticketId);
      if (commentIds.length > 0) {
        builder.orWhereIn('comment_id', commentIds);
      }
    })
    .delete();

  await tenantScopedTable(trx, 'comments', tenant)
    .where({ ticket_id: ticketId })
    .delete();

  await tenantScopedTable(trx, 'ticket_resources', tenant)
    .where({ ticket_id: ticketId })
    .delete();

  await tenantScopedTable(trx, 'project_ticket_links', tenant)
    .where({ ticket_id: ticketId })
    .delete();

  // Delete SLA notification tracking records (CitusDB doesn't support ON DELETE CASCADE)
  await tenantScopedTable(trx, 'sla_notifications_sent', tenant)
    .where({ ticket_id: ticketId })
    .delete();

  // Detach SLA audit log rows from the ticket rather than deleting them.
  // The audit log is the system of record for SLA compliance reporting
  // and forensics; we preserve the rows by NULL-ing ticket_id (FK is
  // MATCH SIMPLE so a NULL satisfies the constraint) and stashing the
  // original ticket id + number into event_data so the audit trail still
  // answers "what ticket was this about?".
  const detachMetadata = JSON.stringify({
    _detached_from_ticket_id: ticketId,
    _detached_from_ticket_number: ticket.ticket_number ?? null,
    _detached_at: new Date().toISOString(),
  });
  await tenantScopedTable(trx, 'sla_audit_log', tenant)
    .where({ ticket_id: ticketId })
    .update({
      ticket_id: null,
      event_data: trx.raw(
        `COALESCE(event_data, '{}'::jsonb) || ?::jsonb`,
        [detachMetadata]
      ),
    });

  // Delete ticket activity/audit log rows (CitusDB doesn't support ON DELETE
  // CASCADE). Unlike sla_audit_log, ticket_audit_logs.ticket_id is NOT NULL
  // and its FK has no ON DELETE action, so the rows must be removed before the
  // ticket itself can be deleted.
  await tenantScopedTable(trx, 'ticket_audit_logs', tenant)
    .where({ ticket_id: ticketId })
    .delete();
}
