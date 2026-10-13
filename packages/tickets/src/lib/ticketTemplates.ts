// Pure rules for ticket templates. Deliberately NOT a 'use server' module: nothing here may become a
// client-callable action. `actions/ticketTemplateActions.ts` and `addTicket` are the entry points.
//
// The authoritative copy sets live in docs/plans/2026-10-13-create-template-from-ticket-plan.md.

import { z } from 'zod';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  TicketTemplateChecklistItemDraft,
  TicketTemplateDraft,
  TicketTemplateReferenceProblem,
} from '@alga-psa/types';
import { pickDuplicableAttributes, type ChecklistItemToInsert } from './ticketDuplicate';

const uuid = z.string().uuid();

// LEVERAGE: pattern ticket-template-fields — title/description/board/category/priority/tags/checklist group is carried by both ticket templates and recurring_ticket_definitions (lib/recurring/definitionInput.ts); recurring should reference a ticket template instead
export const ticketTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    notes: z.string().max(2000).nullable().default(null),
    title: z.string().trim().min(1, 'Title is required').max(500),
    /** Same format as `tickets.attributes.description` (serialized BlockNote JSON or plain text). */
    description: z.string().nullable().default(null),
    board_id: uuid.nullable().default(null),
    category_id: uuid.nullable().default(null),
    subcategory_id: uuid.nullable().default(null),
    priority_id: uuid.nullable().default(null),
    itil_impact: z.number().int().min(1).max(5).nullable().default(null),
    itil_urgency: z.number().int().min(1).max(5).nullable().default(null),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    custom_fields: z
      .record(z.string(), z.unknown())
      .refine((fields) => Object.keys(fields).length <= 100, 'At most 100 custom fields')
      .default({}),
    checklist: z
      .array(
        z
          .object({
            item_name: z.string().trim().min(1, 'Checklist item name is required').max(500),
            description: z.string().nullable().optional().transform((value) => value ?? null),
            is_required: z.boolean(),
            checklist_template_id: uuid.nullable().optional().transform((value) => value ?? null),
          })
          .strict()
      )
      .max(200)
      .default([]),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.subcategory_id && !input.category_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subcategory_id'],
        message: 'A subcategory requires a category',
        params: { messageKey: 'features/tickets:templates.errors.subcategoryNeedsCategory' },
      });
    }
  });

export type TicketTemplateInput = z.input<typeof ticketTemplateInputSchema>;
export type ParsedTicketTemplateInput = z.output<typeof ticketTemplateInputSchema>;

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

export interface TicketTemplateReferenceFields {
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
}

/**
 * Checks that the board, category (and that it belongs to the board), subcategory (and its parent)
 * and priority a template points at still exist. There are no foreign keys (D10), so this runs on
 * save and again whenever a template is read for editing or applied.
 */
// LEVERAGE: pattern ticket-field-reference-validation — same board/category/subcategory/priority existence checks as findRecurringReferenceProblems (lib/recurring/validateReferences.ts); a shared ticket-field validator belongs below both
export async function findTicketTemplateReferenceProblems(
  conn: Knex | Knex.Transaction,
  tenant: string,
  fields: TicketTemplateReferenceFields
): Promise<TicketTemplateReferenceProblem[]> {
  const db = tenantDb(conn, tenant);
  const problems: TicketTemplateReferenceProblem[] = [];

  let board: { board_id: string; board_name: string; is_inactive: boolean } | undefined;
  if (fields.board_id) {
    board = await db.table('boards').where({ board_id: fields.board_id }).first('board_id', 'board_name', 'is_inactive');
    if (!board) {
      problems.push({ field: 'board_id', message: 'Board no longer exists' });
    } else if (board.is_inactive) {
      problems.push({ field: 'board_id', message: `Board ‘${board.board_name}’ is inactive` });
    }
  }

  if (fields.priority_id) {
    const priority = await db
      .table('priorities')
      .where({ priority_id: fields.priority_id, item_type: 'ticket' })
      .first('priority_id');
    if (!priority) problems.push({ field: 'priority_id', message: 'Priority no longer exists' });
  }

  if (fields.subcategory_id && !fields.category_id) {
    problems.push({ field: 'subcategory_id', message: 'A subcategory requires a category' });
  }
  if (fields.category_id) {
    const category = await db
      .table('categories')
      .where({ category_id: fields.category_id })
      .first('category_id', 'category_name', 'board_id', 'parent_category');
    if (!category) {
      problems.push({ field: 'category_id', message: 'Category no longer exists' });
    } else if (category.parent_category) {
      problems.push({ field: 'category_id', message: `Category ‘${category.category_name}’ is a subcategory` });
    } else if (fields.board_id && category.board_id && category.board_id !== fields.board_id) {
      problems.push({ field: 'category_id', message: `Category ‘${category.category_name}’ does not belong to the selected board` });
    }
    if (category && fields.subcategory_id) {
      const sub = await db
        .table('categories')
        .where({ category_id: fields.subcategory_id })
        .first('category_id', 'category_name', 'parent_category');
      if (!sub) {
        problems.push({ field: 'subcategory_id', message: 'Subcategory no longer exists' });
      } else if (sub.parent_category !== fields.category_id) {
        problems.push({ field: 'subcategory_id', message: `Subcategory ‘${sub.category_name}’ does not belong to the selected category` });
      }
    }
  }

  return problems;
}
