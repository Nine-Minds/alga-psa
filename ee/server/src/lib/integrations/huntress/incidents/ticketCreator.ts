/**
 * Transactional ticket creation for Huntress incidents. Mirrors the NinjaOne
 * ticket creator (ee/server/src/lib/integrations/ninjaone/alerts/ticketCreator.ts)
 * but takes the caller's transaction so the alert-row update commits
 * atomically with the ticket, and writes the post-rename board/category
 * columns.
 */

import { Knex } from 'knex';
import { resolveRmmTicketContactId } from '@alga-psa/shared/rmm/alerts';

export interface CreateHuntressTicketParams {
  clientId: string;
  boardId: string;
  priorityId?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  title: string;
  body: string;
  /** Internal audit note added as the first comment. */
  note: string;
  /** Huntress incident id, stringified. */
  sourceReference: string;
  assetId?: string | null;
  defaultContactId?: string | null;
}

export interface CreatedHuntressTicket {
  ticket_id: string;
  ticket_number: string;
}

export async function createHuntressTicket(
  trx: Knex.Transaction,
  tenantId: string,
  params: CreateHuntressTicketParams
): Promise<CreatedHuntressTicket> {
  // Statuses are board-scoped (status_type/board_id); prefer the target
  // board's default, falling back to any tenant ticket default.
  const defaultStatus = (await trx('statuses')
    .where({ tenant: tenantId, status_type: 'ticket', is_default: true, board_id: params.boardId })
    .first()) ??
    (await trx('statuses')
      .where({ tenant: tenantId, status_type: 'ticket', is_default: true })
      .first());
  if (!defaultStatus) {
    throw new Error('No default ticket status configured for tenant');
  }

  // Delegate to the same DB function the UI/API create path uses so Huntress
  // tickets share the tenant's configured numbering (prefix + single sequence),
  // rather than a private max()+default-prefix scheme.
  const numberResult = await trx.raw(
    'SELECT generate_next_number(?::uuid, ?::text) as number',
    [tenantId, 'TICKET']
  );
  const ticketNumber = numberResult?.rows?.[0]?.number;
  if (!ticketNumber) {
    throw new Error('Failed to generate ticket number');
  }
  const contactId = await resolveRmmTicketContactId(trx, tenantId, {
    clientId: params.clientId,
    mappingDefaultContactId: params.defaultContactId,
  });
  const now = new Date().toISOString();

  const [ticket] = await trx('tickets')
    .insert({
      tenant: tenantId,
      ticket_number: ticketNumber,
      title: params.title,
      client_id: params.clientId,
      contact_name_id: contactId,
      status_id: defaultStatus.status_id,
      priority_id: params.priorityId ?? null,
      board_id: params.boardId,
      category_id: params.categoryId ?? null,
      subcategory_id: params.subcategoryId ?? null,
      // The live tickets schema has no description/source_reference/created_at
      // columns: the body and provenance live in the attributes JSONB, and
      // entered_at is the creation timestamp.
      attributes: JSON.stringify({
        description: params.body,
        source_reference: params.sourceReference,
      }),
      source: 'huntress',
      entered_at: now,
      updated_at: now,
    })
    .returning(['ticket_id', 'ticket_number']);

  if (params.assetId) {
    // asset_associations.created_by is NOT NULL with an FK to users, so a
    // system-created link is attributed to the tenant's earliest user.
    const auditUser = await trx('users')
      .where({ tenant: tenantId })
      .orderBy('created_at', 'asc')
      .first('user_id');
    if (auditUser) {
      await trx('asset_associations').insert({
        tenant: tenantId,
        asset_id: params.assetId,
        entity_id: ticket.ticket_id,
        entity_type: 'ticket',
        relationship_type: 'related',
        created_by: auditUser.user_id,
        created_at: now,
      });
    }
  }

  await addTicketInternalNote(trx, tenantId, ticket.ticket_id, params.note);

  return ticket as CreatedHuntressTicket;
}

/**
 * System-authored internal note. comments.thread_id is NOT NULL, so the
 * thread row is created first (same pattern as the NinjaOne creator).
 */
export async function addTicketInternalNote(
  trx: Knex.Transaction,
  tenantId: string,
  ticketId: string,
  note: string
): Promise<void> {
  const now = new Date().toISOString();
  const generated = await trx.raw(
    'SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id'
  );
  const ids = generated.rows?.[0] as { comment_id: string; thread_id: string } | undefined;
  if (!ids?.comment_id || !ids?.thread_id) {
    throw new Error('Failed to generate comment/thread identifiers');
  }

  await trx('comment_threads').insert({
    tenant: tenantId,
    thread_id: ids.thread_id,
    ticket_id: ticketId,
    project_task_id: null,
    root_comment_id: ids.comment_id,
    is_internal: true,
    reply_count: 0,
    last_activity_at: now,
    created_at: now,
    created_by: null,
  });

  // The live comments schema stores the text in `note` (NOT NULL) and flags
  // system authorship with is_system_generated; there is no comment_type.
  await trx('comments').insert({
    tenant: tenantId,
    comment_id: ids.comment_id,
    thread_id: ids.thread_id,
    ticket_id: ticketId,
    user_id: null,
    note,
    is_internal: true,
    is_resolution: false,
    is_system_generated: true,
    created_at: now,
  });
}
