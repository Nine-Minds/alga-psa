import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { flattenBlockContentToPlainText } from '@alga-psa/formatting/blocknoteUtils';
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

/** Why a template was not applied, when that is not simply "already applied" / "no items". */
export const CHECKLIST_TEMPLATE_CLIENT_MISMATCH = 'template-client-mismatch' as const;

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

/**
 * Template scope predicate: a template with no client is tenant-wide; otherwise it is only in
 * scope for tickets of that client. Independent of auto-apply rule matching.
 */
export function isChecklistTemplateInScopeForClient(
  templateClientId: string | null | undefined,
  ticketClientId: string | null | undefined
): boolean {
  return !templateClientId || templateClientId === ticketClientId;
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

export type ChecklistKeywordMode = 'any' | 'all';
export type ChecklistKeywordTarget = 'title' | 'description' | 'title_and_description';

/**
 * Matchers of an auto-apply rule. Every matcher is optional: null / empty
 * means "match any", and all matchers combine with AND.
 *
 * "From service request" is stored as its own boolean (`from_service_request`)
 * rather than a sentinel in `ticket_origins`; naming a definition implies it.
 * Service-request tickets carry no ticket_origin value of their own.
 */
export interface ChecklistApplyRuleMatchers {
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  client_ids?: string[] | null;
  ticket_origins?: string[] | null;
  from_service_request?: boolean | null;
  service_request_definition_id?: string | null;
  keywords?: string[] | null;
  keyword_mode?: ChecklistKeywordMode | null;
  keyword_target?: ChecklistKeywordTarget | null;
}

interface ChecklistTemplateApplyRuleRow extends ChecklistApplyRuleMatchers {
  template_id: string;
}

/** Everything a rule can be evaluated against. */
export interface ChecklistRuleTicketInput {
  board_id?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  priority_id?: string | null;
  client_id?: string | null;
  ticket_origin?: string | null;
  title?: string | null;
  description?: string | null;
  fromServiceRequest: boolean;
  serviceRequestDefinitionId: string | null;
}

/**
 * Explicit service-request context for a ticket that is being created from one.
 * At create time service_request_submissions.created_ticket_id is still NULL
 * (it is written after the ticket exists), so the lookup cannot see it.
 */
export interface TicketServiceRequestContext {
  definitionId: string;
}

/**
 * Reduce a ticket description to the text the user can see. Rich-text
 * descriptions are BlockNote JSON (string, or already-parsed array/object in
 * jsonb); keyword matching must never run against that raw JSON. Plain /
 * markdown strings pass through unchanged. Returns null when nothing visible.
 */
export function ticketDescriptionToPlainText(value: unknown): string | null {
  let candidate = value;
  if (typeof value === 'string') {
    const raw: string = value;
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        candidate = JSON.parse(trimmed);
      } catch {
        // Not JSON (e.g. "[x] done"): plain text, unchanged.
        return trimmed === '' ? null : raw;
      }
    } else {
      // Includes plain text that happens to be valid JSON scalars ("123", "null").
      return trimmed === '' ? null : raw;
    }
  }
  const isBlockArray = Array.isArray(candidate);
  const isDoc =
    !!candidate && typeof candidate === 'object' && (candidate as { type?: unknown }).type === 'doc';
  if (!isBlockArray && !isDoc) return null;
  const text = flattenBlockContentToPlainText(candidate);
  return text.trim() === '' ? null : text;
}

/**
 * Tickets have no description column: the text lives in attributes.description
 * (jsonb, normally already parsed; tolerate a JSON string). Returns plain text.
 */
export function ticketDescriptionFromAttributes(attributes: unknown): string | null {
  let attrs = attributes;
  if (typeof attrs === 'string') {
    try {
      attrs = JSON.parse(attrs);
    } catch {
      return null;
    }
  }
  const description = (attrs as { description?: unknown } | null | undefined)?.description;
  return ticketDescriptionToPlainText(description);
}

function normalizeKeywords(keywords: string[] | null | undefined): string[] {
  return (keywords ?? []).map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0);
}

/**
 * Pure predicate: does this auto-apply rule match this ticket?
 * Null / empty matchers match anything; all matchers combine with AND.
 * Keywords are trimmed + lowercased (empties ignored) and matched as
 * case-insensitive substrings — no regex.
 */
// LEVERAGE: pattern rule-matching — third copy of "null matcher = any, AND the rest" (also ticket templates, workflow conditions); extract a shared predicate layer when the third engine needs it
export function ruleMatchesTicket(
  rule: ChecklistApplyRuleMatchers,
  ticket: ChecklistRuleTicketInput
): boolean {
  if (rule.board_id != null && rule.board_id !== ticket.board_id) return false;
  if (rule.category_id != null && rule.category_id !== ticket.category_id) return false;
  if (rule.subcategory_id != null && rule.subcategory_id !== ticket.subcategory_id) return false;
  if (rule.priority_id != null && rule.priority_id !== ticket.priority_id) return false;

  if (rule.client_ids && rule.client_ids.length > 0) {
    if (!ticket.client_id || !rule.client_ids.includes(ticket.client_id)) return false;
  }

  if (rule.ticket_origins && rule.ticket_origins.length > 0) {
    if (!ticket.ticket_origin || !rule.ticket_origins.includes(ticket.ticket_origin)) return false;
  }

  if (rule.from_service_request || rule.service_request_definition_id) {
    if (!ticket.fromServiceRequest) return false;
    if (
      rule.service_request_definition_id &&
      rule.service_request_definition_id !== ticket.serviceRequestDefinitionId
    ) {
      return false;
    }
  }

  const keywords = normalizeKeywords(rule.keywords);
  if (keywords.length > 0) {
    const target = rule.keyword_target ?? 'title_and_description';
    const title = (ticket.title ?? '').toLowerCase();
    const description = (ticket.description ?? '').toLowerCase();
    // Fields are searched separately so a keyword can never match across the
    // title/description boundary.
    const fields =
      target === 'title' ? [title] : target === 'description' ? [description] : [title, description];
    const found = (k: string) => fields.some((f) => f.includes(k));
    const ok = (rule.keyword_mode ?? 'any') === 'all' ? keywords.every(found) : keywords.some(found);
    if (!ok) return false;
  }

  return true;
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

/**
 * Evaluates enabled auto-apply rules against a ticket (board / category /
 * subcategory / priority / client / origin / service request / title and
 * description keywords; null matcher = match any) and applies every matching
 * template. Safe to re-run — application is idempotent — so callers invoke it
 * on ticket creation AND whenever board/category change.
 *
 * `serviceRequest`: pass it explicitly when creating a ticket from a service
 * request (the submission row cannot link to the ticket yet). When omitted the
 * link is looked up ONCE per call from service_request_submissions, and only
 * if some enabled rule actually constrains on service requests.
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
    client_id?: string | null;
    ticket_origin?: string | null;
    title?: string | null;
    description?: string | null;
    serviceRequest?: TicketServiceRequestContext | null;
  },
  auditContext: ChecklistApplyAuditContext = SYSTEM_CHECKLIST_AUDIT_CONTEXT
): Promise<number> {
  const rules = await tenantDb(trx, tenant)
    .tenantJoin(
      tenantScopedTable(trx, 'checklist_template_apply_rules as r', tenant),
      'checklist_templates as t',
      't.template_id',
      'r.template_id'
    )
    .where({ 'r.is_enabled': true, 't.is_active': true })
    .select('r.*') as ChecklistTemplateApplyRuleRow[];

  const needsServiceRequest = rules.some(
    (rule) => rule.from_service_request || rule.service_request_definition_id
  );
  let serviceRequestDefinitionId: string | null = ticket.serviceRequest?.definitionId ?? null;
  if (needsServiceRequest && ticket.serviceRequest === undefined) {
    const submission = await tenantScopedTable(trx, 'service_request_submissions', tenant)
      .where({ created_ticket_id: ticket.ticket_id })
      .first('definition_id');
    serviceRequestDefinitionId = submission?.definition_id ?? null;
  }

  const ruleTicket: ChecklistRuleTicketInput = {
    ...ticket,
    fromServiceRequest: serviceRequestDefinitionId !== null,
    serviceRequestDefinitionId,
  };

  const matching = rules.filter((rule) => ruleMatchesTicket(rule, ruleTicket));

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
    // Out-of-scope templates (reason set) are skipped silently: rule match and template scope
    // are independent predicates, and the matcher above deliberately knows nothing of scope.
    if (result.applied) appliedCount++;
  }
  return appliedCount;
}
