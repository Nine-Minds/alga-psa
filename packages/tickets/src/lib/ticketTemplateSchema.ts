// Client-safe ticket template input schema. Imports only zod: client components (TicketTemplateEditor)
// import this, so it must never reach @alga-psa/db, knex or pg. Guarded by ticketTemplateSchema.guard.test.ts.

import { z } from 'zod';

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
