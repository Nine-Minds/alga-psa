import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { compilePredicateFragment } from '@alga-psa/predicates/sql';
import { createTicketQuerySchema } from '../ticketQuery/ticketQuerySchema';
import { readChecklistWhere } from './rulePredicates';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
  type TicketActivityActorInfo,
  type TicketActivitySource,
} from '../ticketActivity';
import { CHECKLIST_TEMPLATE_CLIENT_MISMATCH, isChecklistTemplateInScopeForClient } from './scope';

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
  /**
   * Set when the template was refused. `template-client-mismatch`: the template is scoped to a
   * client (checklist_templates.client_id) other than the ticket's client. Nothing is inserted and
   * no activity is written. Callers decide how to surface it (manual: error; auto-apply and
   * ticket creation: skip; workflow: report in the action output).
   */
  reason?: typeof CHECKLIST_TEMPLATE_CLIENT_MISMATCH;
}

export interface ChecklistApplyAuditContext {
  actor: TicketActivityActorInfo;
  source: TicketActivitySource | string;
}

interface ChecklistTemplateRow {
  name: string;
  client_id: string | null;
}

interface ChecklistTemplateItemRow {
  item_name: string;
  description: string | null;
  is_required: boolean;
}

export const SYSTEM_CHECKLIST_AUDIT_CONTEXT: ChecklistApplyAuditContext = {
  actor: { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM },
  source: TICKET_ACTIVITY_SOURCE.SYSTEM,
};

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export async function applyChecklistTemplateToTicket(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  templateId: string,
  source: 'template' | 'workflow',
  auditContext: ChecklistApplyAuditContext = SYSTEM_CHECKLIST_AUDIT_CONTEXT
): Promise<ApplyChecklistTemplateResult> {
  const template = await tenantScopedTable(trx, 'checklist_templates', tenant)
    .where({ template_id: templateId })
    .first() as ChecklistTemplateRow | undefined;
  if (!template) {
    throw new Error('Checklist template not found');
  }

  // Client scope. Enforced here, the single apply chokepoint, so no caller can bypass it.
  if (template.client_id) {
    const ticket = await tenantScopedTable(trx, 'tickets', tenant)
      .where({ ticket_id: ticketId })
      .first('client_id') as { client_id: string | null } | undefined;
    if (!ticket) {
      throw new Error('Ticket not found');
    }
    if (!isChecklistTemplateInScopeForClient(template.client_id, ticket.client_id)) {
      return { applied: false, itemsAdded: 0, reason: CHECKLIST_TEMPLATE_CLIENT_MISMATCH };
    }
  }

  // Idempotency: a template never applies twice to the same ticket.
  const alreadyApplied = await tenantScopedTable(trx, 'ticket_checklist_items', tenant)
    .where({ ticket_id: ticketId, template_id: templateId })
    .first();
  if (alreadyApplied) {
    return { applied: false, itemsAdded: 0 };
  }

  const templateItems = await tenantScopedTable(trx, 'checklist_template_items', tenant)
    .where({ template_id: templateId })
    .orderBy('order_number', 'asc') as ChecklistTemplateItemRow[];
  if (!templateItems.length) {
    return { applied: false, itemsAdded: 0 };
  }

  const maxOrder = await tenantScopedTable(trx, 'ticket_checklist_items', tenant)
    .where({ ticket_id: ticketId })
    .max('order_number as max')
    .first();
  const baseOrder = (Number(maxOrder?.max ?? -1)) + 1;

  await tenantScopedTable(trx, 'ticket_checklist_items', tenant).insert(
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

/** Match every enabled rule against the ticket itself in one evaluation statement. */
export async function matchingRuleTemplateIds(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<string[]> {
  const db = tenantDb(trx, tenant);
  const rules = await db.tenantJoin(
    db.table('checklist_template_apply_rules as r'),
    'checklist_templates as template', 'template.template_id', 'r.template_id'
  ).where({ 'r.is_enabled': true, 'template.is_active': true })
    .select('r.template_id', 'r.where', 'r.where_version') as Array<{
      template_id: string; where: unknown; where_version: number;
    }>;
  if (!rules.length) return [];
  const schema = createTicketQuerySchema();
  const fragments = rules.map((rule) => compilePredicateFragment(
    schema, readChecklistWhere(rule.where, rule.where_version), { rootAlias: 't' }
  ));
  const row = await db.table('tickets as t').where('t.ticket_id', ticketId)
    .select(fragments.map((fragment, index) => trx.raw(`(${fragment.sql}) AS ??`, [...fragment.bindings, `r${index}`])))
    .first() as Record<string, boolean> | undefined;
  return [...new Set(rules.filter((_rule, index) => row?.[`r${index}`] === true).map((rule) => rule.template_id))];
}

/** Creation and board/category changes share the same idempotent application path. */
export async function applyMatchingChecklistTemplates(
  trx: Knex.Transaction,
  tenant: string,
  ticket: { ticket_id: string },
  auditContext: ChecklistApplyAuditContext = SYSTEM_CHECKLIST_AUDIT_CONTEXT
): Promise<number> {
  const templateIds = await matchingRuleTemplateIds(trx, tenant, ticket.ticket_id);
  let appliedCount = 0;
  for (const templateId of templateIds) {
    const result = await applyChecklistTemplateToTicket(trx, tenant, ticket.ticket_id, templateId, 'template', auditContext);
    if (result.applied) appliedCount++;
  }
  return appliedCount;
}
