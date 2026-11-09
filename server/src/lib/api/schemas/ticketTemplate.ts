/**
 * Ticket Template API Schemas
 *
 * Request contracts for /api/v1/tickets/templates. The bodies mirror
 * `ticketTemplateInputSchema` (packages/tickets/src/lib/ticketTemplateSchema.ts), which the reused
 * server actions parse again — validating here only buys the caller a precise 400 instead of a
 * generic one, so the two must stay in step.
 */

import { z } from 'zod';
import { uuidSchema, booleanTransform } from './common';

const checklistItemSchema = z.object({
  item_name: z.string().trim().min(1, 'Checklist item name is required').max(500),
  description: z.string().nullable().optional(),
  is_required: z.boolean(),
  /** Checklist template the item came from; drives the replacement rule when the template is applied. */
  checklist_template_id: uuidSchema.nullable().optional(),
}).strict();

/**
 * Documentation link carried by a template; always copied onto tickets as a `reference`, so there is
 * no `relationship` field. Mirrors `ticketTemplateLinkSchema` in packages/tickets.
 */
const templateLinkSchema = z.object({
  system: z.string().trim().min(1, 'System is required').max(100),
  external_id: z.string().trim().min(1, 'External ID is required').max(2000),
  realm: z.string().max(500).nullable().optional(),
  url: z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), 'URL must use http or https').nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();

export const createTicketTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  /** Admin note about the template; never copied to tickets. */
  notes: z.string().max(2000).nullable().optional(),
  /** Ticket title; may contain {{client}}, {{contact}}, {{due_date}}, {{month}}, {{year}}. */
  title: z.string().trim().min(1, 'Title is required').max(500),
  description: z.string().nullable().optional(),
  /** Client the template belongs to. Omit or null for a template every client can use. */
  client_id: uuidSchema.nullable().optional(),
  board_id: uuidSchema.nullable().optional(),
  category_id: uuidSchema.nullable().optional(),
  subcategory_id: uuidSchema.nullable().optional(),
  priority_id: uuidSchema.nullable().optional(),
  itil_impact: z.number().int().min(1).max(5).nullable().optional(),
  itil_urgency: z.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  /** Whether the template is offered in the new-ticket picker. Defaults to true on create. */
  offer_for_manual_use: z.boolean().optional(),
  /** The whole checklist: an update replaces the stored items with this list. */
  checklist: z.array(checklistItemSchema).max(200).optional(),
  /** Documentation links, copied onto each created ticket as references. An update replaces the stored list. */
  links: z.array(templateLinkSchema).max(50).optional().superRefine((links, ctx) => {
    const seen = new Set<string>();
    (links ?? []).forEach((link, index) => {
      const key = `${link.system.trim()}\u0000${link.external_id.trim()}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: [index], message: 'Duplicate documentation link' });
      }
      seen.add(key);
    });
  }),
}).strict();

/** PUT replaces the template wholesale, plus the optional activate/deactivate flag. */
export const updateTicketTemplateSchema = createTicketTemplateSchema.extend({
  is_active: z.boolean().optional(),
});

export const ticketTemplateListQuerySchema = z.object({
  page: z.string().transform((value) => parseInt(value, 10)).pipe(z.number().min(1)).prefault('1'),
  limit: z.string().transform((value) => parseInt(value, 10)).pipe(z.number().min(1).max(100)).prefault('25'),
  /** Templates this client can use: its own plus the tenant-wide ones. */
  client_id: uuidSchema.optional(),
  /** Default true: only active templates. Pass false to include inactive ones. */
  is_active: booleanTransform.optional(),
  /** Case-insensitive substring of the template name or ticket title. */
  search: z.string().optional(),
  // Not strict: the shared list conventions (`sort`, `order`, `fields`) are accepted and ignored
  // rather than rejected, as on the other list endpoints.
});

export const instantiateTicketTemplateSchema = z.object({
  /** Client the ticket is for. A client-bound template only accepts its own client. */
  client_id: uuidSchema,
  contact_name_id: uuidSchema.nullable().optional(),
  location_id: uuidSchema.nullable().optional(),
  asset_ids: z.array(uuidSchema).max(50).optional(),
  assigned_to: uuidSchema.nullable().optional(),
  /** Status for the new ticket; must belong to the template's board. Defaults to the board default. */
  status_id: uuidSchema.nullable().optional(),
  /** Due date, ISO date (YYYY-MM-DD) or date-time; also fills the {{due_date}} title token. */
  due_date: z.string().nullable().optional(),
  suppressContactNotifications: z.boolean().optional(),
  suppressInternalNotifications: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.suppressInternalNotifications === true && value.suppressContactNotifications !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['suppressInternalNotifications'],
      message: 'suppressInternalNotifications requires suppressContactNotifications',
    });
  }
  if (value.due_date && Number.isNaN(Date.parse(value.due_date))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['due_date'], message: 'due_date must be an ISO date or date-time' });
  }
});

export type CreateTicketTemplateRequest = z.infer<typeof createTicketTemplateSchema>;
export type UpdateTicketTemplateRequest = z.infer<typeof updateTicketTemplateSchema>;
export type InstantiateTicketTemplateRequest = z.infer<typeof instantiateTicketTemplateSchema>;
