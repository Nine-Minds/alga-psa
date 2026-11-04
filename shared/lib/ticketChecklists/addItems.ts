import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Appends ad-hoc (non-template) checklist items to a ticket, after the current
 * highest order_number. Items are always inserted unchecked and unassigned.
 *
 * Lives in shared next to applyTemplates so the workflow runtime action
 * (`tickets.add_checklist_items`) does not re-implement the insert.
 */

export interface AddChecklistItemInput {
  item_name: string;
  description?: string | null;
  is_required?: boolean;
}

export interface AddedChecklistItem {
  checklist_item_id: string;
  item_name: string;
}

export async function addChecklistItemsToTicket(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  items: AddChecklistItemInput[],
  options: { source: 'manual' | 'workflow'; createdBy?: string | null }
): Promise<AddedChecklistItem[]> {
  if (!items.length) return [];

  const maxOrder = await tenantDb(trx, tenant)
    .table('ticket_checklist_items')
    .where({ ticket_id: ticketId })
    .max('order_number as max')
    .first();
  const baseOrder = Number(maxOrder?.max ?? -1) + 1;

  // LEVERAGE: pattern ticket-checklist-insert — same insert shape as addChecklistItem in packages/tickets (defaults differ: is_required true there, false here)
  const rows = await tenantDb(trx, tenant)
    .table('ticket_checklist_items')
    .insert(
      items.map((item, index) => ({
        tenant,
        ticket_id: ticketId,
        item_name: item.item_name.trim(),
        description: item.description ?? null,
        order_number: baseOrder + index,
        is_required: item.is_required ?? false,
        source: options.source,
        template_id: null,
        created_by: options.createdBy ?? null,
      }))
    )
    .returning(['checklist_item_id', 'item_name']);

  return rows as AddedChecklistItem[];
}
