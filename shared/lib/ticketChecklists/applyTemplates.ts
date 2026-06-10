import type { Knex } from 'knex';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
  type TicketActivityActorInfo,
  type TicketActivitySource,
} from '../ticketActivity';

/**
 * Applying a checklist template copies its items onto the ticket. The copy
 * carries template provenance (template_id), which doubles as the idempotency
 * key: a template that already contributed items to a ticket is never applied
 * again. Template edits after application don't touch the copies.
 *
 * Lives in shared (not packages/tickets) so TicketModel.createTicket can run
 * auto-apply at the single creation chokepoint without a circular import.
 * See docs/plans/2026-06-10-ticket-close-rules/PRD.md §5.2.
 */

export interface ApplyChecklistTemplateResult {
  applied: boolean;
  itemsAdded: number;
}

export interface ChecklistApplyAuditContext {
  actor: TicketActivityActorInfo;
  source: TicketActivitySource | string;
}

export const SYSTEM_CHECKLIST_AUDIT_CONTEXT: ChecklistApplyAuditContext = {
  actor: { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM },
  source: TICKET_ACTIVITY_SOURCE.SYSTEM,
};

export async function applyChecklistTemplateToTicket(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  templateId: string,
  source: 'template' | 'workflow',
  auditContext: ChecklistApplyAuditContext = SYSTEM_CHECKLIST_AUDIT_CONTEXT
): Promise<ApplyChecklistTemplateResult> {
  const template = await trx('checklist_templates')
    .where({ tenant, template_id: templateId })
    .first();
  if (!template) {
    throw new Error('Checklist template not found');
  }

  // Idempotency: a template never applies twice to the same ticket.
  const alreadyApplied = await trx('ticket_checklist_items')
    .where({ tenant, ticket_id: ticketId, template_id: templateId })
    .first();
  if (alreadyApplied) {
    return { applied: false, itemsAdded: 0 };
  }

  const templateItems = await trx('checklist_template_items')
    .where({ tenant, template_id: templateId })
    .orderBy('order_number', 'asc');
  if (!templateItems.length) {
    return { applied: false, itemsAdded: 0 };
  }

  const maxOrder = await trx('ticket_checklist_items')
    .where({ tenant, ticket_id: ticketId })
    .max('order_number as max')
    .first();
  const baseOrder = (Number(maxOrder?.max ?? -1)) + 1;

  await trx('ticket_checklist_items').insert(
    templateItems.map((item, index) => ({
      tenant,
      ticket_id: ticketId,
      item_name: item.item_name,
      description: item.description,
      order_number: baseOrder + index,
      is_required: item.is_required,
      source,
      template_id: templateId,
    }))
  );

  await writeTicketActivity(trx, {
    tenant,
    ticketId,
    eventType: TICKET_ACTIVITY_EVENT.CHECKLIST_TEMPLATE_APPLIED,
    entityType: TICKET_ACTIVITY_ENTITY.CHECKLIST_ITEM,
    entityId: templateId,
    actor: auditContext.actor,
    source: auditContext.source,
    details: {
      template_name: template.name,
      items_added: templateItems.length,
    },
  });

  return { applied: true, itemsAdded: templateItems.length };
}

/**
 * Evaluates enabled auto-apply rules against a ticket's board / category /
 * subcategory / priority (null matcher = match any) and applies every
 * matching template. Safe to re-run — application is idempotent — so callers
 * invoke it on ticket creation AND whenever board/category change.
 */
export async function applyMatchingChecklistTemplates(
  trx: Knex.Transaction,
  tenant: string,
  ticket: {
    ticket_id: string;
    board_id?: string | null;
    category_id?: string | null;
    subcategory_id?: string | null;
    priority_id?: string | null;
  },
  auditContext: ChecklistApplyAuditContext = SYSTEM_CHECKLIST_AUDIT_CONTEXT
): Promise<number> {
  const rules = await trx('checklist_template_apply_rules as r')
    .join('checklist_templates as t', function joinTemplates() {
      this.on('t.template_id', 'r.template_id').andOn('t.tenant', 'r.tenant');
    })
    .where({ 'r.tenant': tenant, 'r.is_enabled': true, 't.is_active': true })
    .select('r.*');

  const matching = rules.filter(
    (rule) =>
      (rule.board_id === null || rule.board_id === ticket.board_id) &&
      (rule.category_id === null || rule.category_id === ticket.category_id) &&
      (rule.subcategory_id === null || rule.subcategory_id === ticket.subcategory_id) &&
      (rule.priority_id === null || rule.priority_id === ticket.priority_id)
  );

  let appliedCount = 0;
  const seenTemplates = new Set<string>();
  for (const rule of matching) {
    if (seenTemplates.has(rule.template_id)) continue;
    seenTemplates.add(rule.template_id);
    const result = await applyChecklistTemplateToTicket(
      trx,
      tenant,
      ticket.ticket_id,
      rule.template_id,
      'template',
      auditContext
    );
    if (result.applied) appliedCount++;
  }
  return appliedCount;
}
