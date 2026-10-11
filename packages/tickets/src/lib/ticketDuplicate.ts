// Copy-set rules for "Duplicate ticket". Deliberately NOT a 'use server' module:
// nothing here may become a client-callable action. `addTicket` and
// `getTicketDuplicateSource` (ticketActions.ts) are the only entry points.
//
// The authoritative copy set lives in docs/plans/2026-10-02-duplicate-ticket-plan.md.

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Shape returned to the create-ticket form to prefill a duplicate. */
export interface TicketDuplicateSource {
  ticket_id: string;
  ticket_number: string;
  title: string;
  /** `attributes.description` as stored (plain text or serialized rich-text JSON). */
  description: string;
  client: { id: string; name: string; type: string | null };
  contact: { id: string; name: string } | null;
  location_id: string | null;
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  itil_impact: number | null;
  itil_urgency: number | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agents: { user_id: string; first_name: string | null; last_name: string | null }[];
  tags: {
    tag_id: string;
    tag_text: string;
    background_color: string | null;
    text_color: string | null;
  }[];
  checklist: { item_name: string; is_required: boolean }[];
  custom_field_count: number;
}

/**
 * Attributes allowlist (D7): only `custom_fields` carries over to a duplicate.
 * Every other `attributes` key is system-owned (description is supplied by the
 * form; watch_list, sla_last_*_threshold_notified, source_reference,
 * teams_guest_intake, legacy tags and due_date must never be cloned), so this
 * is an allowlist rather than a denylist: a system key added later cannot leak.
 */
export function pickDuplicableAttributes(attributes: unknown): Record<string, unknown> {
  let parsed: unknown = attributes;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const customFields = (parsed as Record<string, unknown>).custom_fields;
  if (
    customFields &&
    typeof customFields === 'object' &&
    !Array.isArray(customFields) &&
    Object.keys(customFields as Record<string, unknown>).length > 0
  ) {
    return { custom_fields: customFields };
  }
  return {};
}

/** Number of custom field values a duplicate would carry over. */
export function countDuplicableCustomFields(attributes: unknown): number {
  const picked = pickDuplicableAttributes(attributes);
  return picked.custom_fields ? Object.keys(picked.custom_fields as Record<string, unknown>).length : 0;
}

interface CopyChecklistParams {
  sourceTicketId: string;
  targetTicketId: string;
  userId: string;
}

/**
 * Copies the source ticket's checklist onto the target, unchecked (D8).
 *
 * `TicketModel.createTicket` has already auto-applied matching templates onto
 * the target inside the same transaction. For every template the source also
 * carries, the source's (possibly edited) items win: the target's freshly
 * applied rows for that template are deleted before the source items go in.
 * `template_id` is kept so the template's idempotency key still suppresses a
 * later re-apply. Templates that newly match and are not on the source stay as
 * auto-applied, and the source's items are ordered after them.
 *
 * Returns the number of items copied.
 */
// LEVERAGE: pattern tenant-scoped-table-helper — tenantScopedTable is redefined in nearly every tickets module; this site calls tenantDb(trx, tenant).table(...) directly instead of adding another copy
export async function copyChecklistFromSource(
  trx: Knex.Transaction,
  tenant: string,
  { sourceTicketId, targetTicketId, userId }: CopyChecklistParams
): Promise<number> {
  const db = tenantDb(trx, tenant);

  const sourceItems = await db
    .table('ticket_checklist_items')
    .where({ ticket_id: sourceTicketId })
    .orderBy('order_number', 'asc')
    .orderBy('created_at', 'asc')
    .select(
      'item_name',
      'description',
      'is_required',
      'assigned_to',
      'order_number',
      'source',
      'template_id'
    );
  if (!sourceItems.length) {
    return 0;
  }

  const templateIds = Array.from(
    new Set(
      sourceItems
        .map((item: { template_id: string | null }) => item.template_id)
        .filter((id: string | null): id is string => Boolean(id))
    )
  );
  if (templateIds.length) {
    await db
      .table('ticket_checklist_items')
      .where({ ticket_id: targetTicketId })
      .whereIn('template_id', templateIds)
      .delete();
  }

  const maxOrder = await db
    .table('ticket_checklist_items')
    .where({ ticket_id: targetTicketId })
    .max('order_number as max')
    .first();
  const baseOrder = Number(maxOrder?.max ?? -1) + 1;

  await db.table('ticket_checklist_items').insert(
    sourceItems.map(
      (
        item: {
          item_name: string;
          description: string | null;
          is_required: boolean;
          assigned_to: string | null;
          source: string;
          template_id: string | null;
        },
        index: number
      ) => ({
        tenant,
        ticket_id: targetTicketId,
        item_name: item.item_name,
        description: item.description ?? null,
        assigned_to: item.assigned_to ?? null,
        is_required: item.is_required,
        order_number: baseOrder + index,
        source: item.source,
        template_id: item.template_id ?? null,
        completed: false,
        completed_by: null,
        completed_at: null,
        created_by: userId,
      })
    )
  );

  return sourceItems.length;
}
