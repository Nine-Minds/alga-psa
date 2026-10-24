import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  writeTicketActivity,
} from '../ticketActivity';
import type { ChecklistApplyAuditContext } from './applyTemplates';

/** A checklist row to be written onto a new ticket, whatever its origin (source ticket or ticket template). */
export interface ChecklistItemToInsert {
  item_name: string;
  description: string | null;
  is_required: boolean;
  assigned_to: string | null;
  /** `ticket_checklist_items.source` ('manual' | 'template'). */
  source: string;
  /** Checklist template this item came from; drives the replacement rule below. */
  template_id: string | null;
}

export interface InsertChecklistParams {
  targetTicketId: string;
  items: readonly ChecklistItemToInsert[];
  /** Null when the system (the recurring generator) creates the ticket. */
  userId: string | null;
  /**
   * When given, a CHECKLIST_TEMPLATE_APPLIED activity (same shape `applyChecklistTemplateToTicket` writes) is
   * recorded for each checklist template the items carry that auto-apply had not already applied.
   */
  audit?: ChecklistApplyAuditContext;
}

/**
 * Appends `items` onto the target ticket, unchecked (Duplicate D8, Ticket template D4).
 *
 * `TicketModel.createTicket` has already auto-applied matching templates onto
 * the target inside the same transaction. For every checklist template the
 * incoming items carry, those items win: the target's freshly applied rows for
 * that template are deleted before the items go in. `template_id` is kept so the
 * template's idempotency key still suppresses a later re-apply. Templates that
 * newly match and are not carried stay as auto-applied, and the incoming items
 * are ordered after them.
 *
 * Shared by Duplicate (items loaded from the source ticket), create-from-ticket-template and the
 * recurring generator (items loaded from the template), so the rule is implemented once. Lives in
 * shared so `createTicketWithSideEffects` can apply owned items inside the create layer.
 * Returns the number of items inserted.
 */
// LEVERAGE: pattern tenant-scoped-table-helper — tenantScopedTable is redefined in nearly every tickets module; this site calls tenantDb(trx, tenant).table(...) directly instead of adding another copy
export async function insertChecklistItemsReplacingTemplates(
  trx: Knex.Transaction,
  tenant: string,
  { targetTicketId, items, userId, audit }: InsertChecklistParams
): Promise<number> {
  if (!items.length) {
    return 0;
  }
  const db = tenantDb(trx, tenant);

  const templateIds = Array.from(
    new Set(items.map((item) => item.template_id).filter((id): id is string => Boolean(id)))
  );
  // Templates whose items auto-apply already put on the ticket: that path wrote the activity, so don't repeat it.
  let alreadyApplied = new Set<string>();
  if (templateIds.length) {
    const existing = await db
      .table('ticket_checklist_items')
      .where({ ticket_id: targetTicketId })
      .whereIn('template_id', templateIds)
      .distinct('template_id');
    alreadyApplied = new Set(existing.map((row: { template_id: string }) => row.template_id));
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
    items.map((item, index) => ({
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
    }))
  );

  if (audit) {
    for (const templateId of templateIds) {
      if (alreadyApplied.has(templateId)) continue;
      const template = await db.table('checklist_templates').where({ template_id: templateId }).first('name');
      await writeTicketActivity(trx, {
        tenant,
        ticketId: targetTicketId,
        eventType: TICKET_ACTIVITY_EVENT.CHECKLIST_TEMPLATE_APPLIED,
        entityType: TICKET_ACTIVITY_ENTITY.CHECKLIST_ITEM,
        entityId: templateId,
        actor: audit.actor,
        source: audit.source,
        details: {
          template_name: template?.name ?? null,
          items_added: items.filter((item) => item.template_id === templateId).length,
        },
      });
    }
  }

  return items.length;
}
