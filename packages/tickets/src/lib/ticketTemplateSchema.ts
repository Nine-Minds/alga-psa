// Client-safe ticket template input schema. Imports only zod: client components (TicketTemplateEditor)
// import this, so it must never reach @alga-psa/db, knex or pg. Guarded by components/templates/__tests__/clientBundleGuard.test.ts.

import { z } from 'zod';
import { findUnknownTitleTokens, TICKET_TITLE_TOKENS } from './ticketTitleTokens';

const uuid = z.string().guid();

/** Template title with `{{token}}` placeholders; an unknown token is a save error (R8). */
export const ticketTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(500)
  .superRefine((title, ctx) => {
    const unknown = findUnknownTitleTokens(title);
    if (unknown.length === 0) return;
    const available = TICKET_TITLE_TOKENS.map((token) => `{{${token}}}`).join(', ');
    const tokens = unknown.map((token) => `{{${token}}}`).join(', ');
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown title token${unknown.length > 1 ? 's' : ''} ${tokens}. Available tokens: ${available}`,
      params: { messageKey: 'features/tickets:templates.errors.unknownTitleTokens', messageParams: { tokens, available } },
    });
  });

export const ticketTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    notes: z.string().max(2000).nullable().default(null),
    title: ticketTitleSchema,
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
    /**
     * Whether the template is offered in the new-ticket picker (R5). Omitted on update = unchanged;
     * omitted on create = offered.
     */
    offer_for_manual_use: z.boolean().optional(),
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
