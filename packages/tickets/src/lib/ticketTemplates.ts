// LEVERAGE: pattern rule-matching — ticket-template defaults remain separate; checklist auto-apply now uses the shared ticket predicate schema (alga-2026-0002836).
// Pure rules for ticket templates. Deliberately NOT a 'use server' module: nothing here may become a
// client-callable action. `actions/ticketTemplateActions.ts` and `addTicket` are the entry points.
//
// The authoritative copy sets live in docs/plans/2026-10-13-create-template-from-ticket-plan.md.

import type {
  TicketTemplateChecklistItemDraft,
  TicketTemplateDraft,
} from '@alga-psa/types';
import { ticketTemplateInputSchema, type ParsedTicketTemplateInput, type TicketTemplateInput } from './ticketTemplateSchema';
import { pickDuplicableAttributes, type ChecklistItemToInsert } from './ticketDuplicate';

export { ticketTemplateInputSchema };
export type { TicketTemplateInput, ParsedTicketTemplateInput };

interface TicketRowForTemplate {
  title: string;
  attributes?: unknown;
  board_id?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  priority_id?: string | null;
  itil_impact?: number | null;
  itil_urgency?: number | null;
}

interface SourceChecklistRow {
  item_name: string;
  description?: string | null;
  is_required: boolean;
  template_id?: string | null;
  // completed / assigned_to may be present on the row; they are never copied.
}

function readAttributes(attributes: unknown): Record<string, unknown> {
  let parsed = attributes;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/**
 * Ticket → template copy set (plan "Copy sets"). Completion state, assignee, client, contact,
 * location, status, assignment, watch list and SLA bookkeeping are never copied.
 */
export function ticketToTemplateDraft(
  source: TicketRowForTemplate,
  { tags, checklist }: { tags: readonly string[]; checklist: readonly SourceChecklistRow[] }
): TicketTemplateDraft {
  const attributes = readAttributes(source.attributes);
  const customFields = pickDuplicableAttributes(attributes).custom_fields as Record<string, unknown> | undefined;
  return {
    name: source.title,
    notes: null,
    title: source.title,
    description: typeof attributes.description === 'string' ? attributes.description : null,
    board_id: source.board_id ?? null,
    category_id: source.category_id ?? null,
    subcategory_id: source.subcategory_id ?? null,
    priority_id: source.priority_id ?? null,
    itil_impact: source.itil_impact ?? null,
    itil_urgency: source.itil_urgency ?? null,
    tags: Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))),
    custom_fields: customFields ? { ...customFields } : {},
    checklist: checklist.map(
      (row): TicketTemplateChecklistItemDraft => ({
        item_name: row.item_name,
        description: row.description ?? null,
        is_required: row.is_required,
        checklist_template_id: row.template_id ?? null,
      })
    ),
  };
}

/**
 * Whether a serialized description embeds an image. Those point at the source ticket's documents
 * and can break once the template outlives the ticket (plan R2).
 */
export function descriptionHasInlineImages(description: string | null | undefined): boolean {
  if (!description) return false;
  return /"type"\s*:\s*"image"/.test(description) || description.includes('/api/documents/view/');
}

/**
 * Template checklist rows → rows for `insertChecklistItemsReplacingTemplates`. Items that came from a
 * checklist template stay `source: 'template'` (so the replacement rule and the existing
 * `ticket_checklist_items_source_check` keep working); the rest are `manual`. Never assigned.
 */
export function templateChecklistToItems(
  rows: readonly {
    item_name: string;
    description?: string | null;
    is_required: boolean;
    checklist_template_id?: string | null;
  }[]
): ChecklistItemToInsert[] {
  return rows.map((row) => ({
    item_name: row.item_name,
    description: row.description ?? null,
    is_required: row.is_required,
    assigned_to: null,
    source: row.checklist_template_id ? 'template' : 'manual',
    template_id: row.checklist_template_id ?? null,
  }));
}
