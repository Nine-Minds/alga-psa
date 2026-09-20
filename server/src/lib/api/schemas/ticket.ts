/**
 * Ticket API Schemas
 * Validation schemas for ticket-related API endpoints
 */

import { z } from 'zod';
import { formatBlockNoteContent } from '@alga-psa/formatting/blocknoteUtils';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  arrayTransform
} from './common';

const MAX_TICKET_COMMENT_LENGTH = 5000;
const ticketNotificationSuppressionSchema = {
  suppressContactNotifications: z.boolean().optional(),
  suppressInternalNotifications: z.boolean().optional(),
};

function validateTicketNotificationSuppression(
  // `unknown` props keep this callback contravariance-compatible with every
  // schema it refines — createUpdateSchema() output types its fields as
  // unknown, which a `boolean`-typed parameter rejects.
  value: {
    suppressContactNotifications?: unknown;
    suppressInternalNotifications?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.suppressInternalNotifications === true && value.suppressContactNotifications !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['suppressInternalNotifications'],
      message: 'suppressInternalNotifications requires suppressContactNotifications',
    });
  }
}

function getVisibleCommentLength(value: string): number {
  return formatBlockNoteContent(value).text.trim().length;
}

// Ticket attributes schema (flexible JSON object)
const ticketAttributesSchema = z.record(z.unknown()).optional();

// External system links. `url` is constrained to http(s) so javascript:/data:
// links can never be persisted; the action layer revalidates.
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'URL must use http or https');

export const externalLinkRelationshipSchema = z.enum(['origin', 'mirror', 'reference']);

export const externalLinkActorSchema = z.object({
  id: z.string().nullable().optional(),
  handle: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  url: httpUrlSchema.nullable().optional(),
});

export const createExternalLinkSchema = z.object({
  entity_type: z.enum(['ticket', 'comment']).optional(),
  comment_id: uuidSchema.optional(),
  system: z.string().trim().min(1, 'System is required'),
  external_id: z.string().trim().min(1, 'External ID is required'),
  external_parent_id: z.string().nullable().optional(),
  realm: z.string().nullable().optional(),
  url: httpUrlSchema.nullable().optional(),
  relationship: externalLinkRelationshipSchema.optional(),
  actor: externalLinkActorSchema.nullable().optional(),
  external_status: z.string().nullable().optional(),
  external_updated_at: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
}).strict();

/**
 * Ticket-level link shape for inline `external_links` arrays on ticket create.
 * The POST /tickets/{id}/external-links endpoint uses the full
 * `createExternalLinkSchema` so integrations can also attach comment-level
 * references by supplying `entity_type`/`comment_id`.
 */
export const createTicketExternalLinkSchema = createExternalLinkSchema.omit({
  entity_type: true,
  comment_id: true,
});

export const updateExternalLinkSchema = z.object({
  relationship: externalLinkRelationshipSchema.optional(),
  url: httpUrlSchema.nullable().optional(),
  actor: externalLinkActorSchema.nullable().optional(),
  external_status: z.string().nullable().optional(),
  external_updated_at: z.string().datetime().nullable().optional(),
  last_synced_at: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
}).strict();

export const externalLinkLookupQuerySchema = z.object({
  system: z.string().trim().min(1, 'system is required'),
  external_id: z.string().trim().min(1, 'external_id is required'),
  external_parent_id: z.string().optional(),
});

/** Ticket-level links accepted inline on ticket create. */
export const inlineTicketExternalLinksSchema = z.array(createTicketExternalLinkSchema).optional();

export type CreateExternalLinkData = z.infer<typeof createExternalLinkSchema>;
export type UpdateExternalLinkData = z.infer<typeof updateExternalLinkSchema>;

// Create ticket schema
export const createTicketSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  url: z.string().url().optional(),
  board_id: uuidSchema,
  client_id: uuidSchema,
  location_id: uuidSchema.optional(),
  contact_name_id: uuidSchema.optional(),
  status_id: uuidSchema,
  category_id: uuidSchema.optional(),
  subcategory_id: uuidSchema.optional(),
  assigned_to: uuidSchema.optional(),
  priority_id: uuidSchema,
  // Optional classification references; stored as nullable same-tenant UUIDs.
  severity_id: uuidSchema.optional(),
  urgency_id: uuidSchema.optional(),
  impact_id: uuidSchema.optional(),
  attributes: ticketAttributesSchema,
  tags: z.array(z.string()).optional(),
  external_links: inlineTicketExternalLinksSchema,
});

// Update ticket schema (all fields optional; contact_name_id is nullable so it can be cleared).
// `external_links` is create-only: it is written through the dedicated
// external-links endpoints, never as part of an ordinary ticket update, so it is
// omitted here and defensively stripped by the service. Classification
// references are create-only in this API surface and are omitted for the same
// reason, preserving the existing accepted update request set.
export const updateTicketSchema = createUpdateSchema(
  createTicketSchema.omit({
    external_links: true,
    severity_id: true,
    urgency_id: true,
    impact_id: true,
  })
).extend({
  contact_name_id: uuidSchema.nullable().optional(),
  response_state: z.enum(['awaiting_client', 'awaiting_internal']).nullable().optional(),
  ...ticketNotificationSuppressionSchema,
  // Close despite unmet close rules; honored only when the caller's user holds
  // ticket:close_override. Stripped before the row update.
  override_close_rules: z.boolean().optional(),
  override_close_rules_reason: z.string().nullable().optional(),
  // Sync-mode bundle master boundary changes require an explicit choice.
  propagateToChildren: z.boolean().optional(),
}).superRefine(validateTicketNotificationSuppression);

// Ticket status update schema
export const updateTicketStatusSchema = z.object({
  status_id: uuidSchema,
  closed_at: z.string().datetime().optional(),
  closed_by: uuidSchema.optional(),
  ...ticketNotificationSuppressionSchema,
  override_close_rules: z.boolean().optional(),
  override_close_rules_reason: z.string().nullable().optional(),
  // Sync-mode bundle master boundary changes require an explicit choice.
  propagateToChildren: z.boolean().optional()
}).superRefine(validateTicketNotificationSuppression);

// Ticket assignment schema
export const updateTicketAssignmentSchema = z.object({
  assigned_to: uuidSchema.nullable().optional(),
  ...ticketNotificationSuppressionSchema,
}).superRefine(validateTicketNotificationSuppression);

// Mobile ticket checklist writes intentionally expose only the subset needed
// for field execution. Template administration, assignment editing, ordering,
// and deletion remain on the web surface.
export const createTicketChecklistItemSchema = z.object({
  item_name: z.string().trim().min(1, 'Checklist item name is required'),
  description: z.string().nullable().optional(),
  is_required: z.boolean().optional(),
}).strict();

export const updateTicketChecklistCompletionSchema = z.object({
  completed: z.boolean(),
}).strict();

export type CreateTicketChecklistItemData = z.infer<typeof createTicketChecklistItemSchema>;
export type UpdateTicketChecklistCompletionData = z.infer<typeof updateTicketChecklistCompletionSchema>;

export const createTicketMaterialSchema = z.object({
  service_id: uuidSchema,
  quantity: z.number().positive('Quantity must be greater than 0'),
  rate: z.number().min(0, 'Rate must be 0 or greater'),
  currency_code: z.string().trim().min(3).max(3).transform((value) => value.toUpperCase()),
  description: z.string().trim().max(1000).nullable().optional(),
  // Serialized tracked products require the specific stock unit to deliver.
  unit_id: uuidSchema.nullable().optional(),
});

// Ticket filter schema
export const ticketFilterSchema = baseFilterSchema.extend({
  title: z.string().optional(),
  ticket_number: z.string().optional(),
  board_id: uuidSchema.optional(),
  client_id: uuidSchema.optional(),
  location_id: uuidSchema.optional(),
  contact_name_id: uuidSchema.optional(),
  status_id: uuidSchema.optional(),
  status_ids: arrayTransform(uuidSchema).optional(),
  category_id: uuidSchema.optional(),
  subcategory_id: uuidSchema.optional(),
  entered_by: uuidSchema.optional(),
  assigned_to: uuidSchema.optional(),
  priority_id: uuidSchema.optional(),
  is_open: booleanTransform.optional(),
  is_closed: booleanTransform.optional(),
  has_assignment: booleanTransform.optional(),
  entered_from: z.string().datetime().optional(),
  entered_to: z.string().datetime().optional(),
  closed_from: z.string().datetime().optional(),
  closed_to: z.string().datetime().optional(),
  client_name: z.string().optional(),
  contact_name: z.string().optional(),
  status_name: z.string().optional(),
  priority_name: z.string().optional(),
  category_name: z.string().optional(),
  board_name: z.string().optional(),
  external_system: z.string().optional(),
  external_id: z.string().optional(),
  // 'bundled' collapses bundle children under their master (the web list's
  // default); 'individual' lists every ticket. Omitted = individual, which
  // keeps existing API consumers' result sets unchanged.
  bundle_view: z.enum(['bundled', 'individual']).optional(),
  tags: z.union([
    z.array(z.string()),
    arrayTransform(z.string())
  ]).transform(tags => tags.map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0)).optional()
});

// Ticket list query schema
export const ticketListQuerySchema = createListQuerySchema(ticketFilterSchema);

// Ticket response schema
export const ticketResponseSchema = z.object({
  ticket_id: uuidSchema,
  ticket_number: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  severity_id: uuidSchema.nullable().optional(),
  urgency_id: uuidSchema.nullable().optional(),
  impact_id: uuidSchema.nullable().optional(),
  board_id: uuidSchema,
  client_id: uuidSchema,
  location_id: uuidSchema.nullable(),
  contact_name_id: uuidSchema.nullable(),
  status_id: uuidSchema,
  category_id: uuidSchema.nullable(),
  subcategory_id: uuidSchema.nullable(),
  entered_by: uuidSchema,
  updated_by: uuidSchema.nullable(),
  closed_by: uuidSchema.nullable(),
  assigned_to: uuidSchema.nullable(),
  entered_at: z.string().datetime(),
  updated_at: z.string().datetime().nullable(),
  closed_at: z.string().datetime().nullable(),
  attributes: ticketAttributesSchema,
  priority_id: uuidSchema,
  tenant: uuidSchema,
  tags: z.array(z.string()).optional()
});

// Ticket with related data response schema
export const ticketWithDetailsResponseSchema = ticketResponseSchema.extend({
  // Joined fields
  client_name: z.string().optional(),
  contact_name: z.string().optional(),
  status_name: z.string().optional(),
  priority_name: z.string().optional(),
  category_name: z.string().optional(),
  subcategory_name: z.string().optional(),
  board_name: z.string().optional(),
  entered_by_name: z.string().optional(),
  assigned_to_name: z.string().optional(),
  location_name: z.string().optional(),
  
  // Related objects
  client: z.object({
    client_id: uuidSchema,
    client_name: z.string(),
    email: z.string().nullable(),
    phone_no: z.string().nullable()
  }).optional(),
  
  contact: z.object({
    contact_name_id: uuidSchema,
    full_name: z.string(),
    email: z.string(),
    phone_number: z.string().nullable()
  }).optional(),
  
  status: z.object({
    status_id: uuidSchema,
    status_name: z.string(),
    is_closed: z.boolean(),
    order_number: z.number()
  }).optional(),
  
  priority: z.object({
    priority_id: uuidSchema,
    priority_name: z.string(),
    order_number: z.number()
  }).optional(),
  
  category: z.object({
    category_id: uuidSchema,
    category_name: z.string()
  }).optional(),
  
  assigned_user: z.object({
    user_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string()
  }).optional(),
  description_html: z.string().optional()
});

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Scheduled publication mirrors the web composer rules: only client-visible
// comments can be withheld, the instant must be in the future, and the IANA
// zone the author scheduled in is stored alongside it.
function validateScheduledCommentPublication(
  data: { scheduled_publish_at?: string; scheduled_publish_tz?: string; is_internal?: boolean },
  ctx: z.RefinementCtx
): void {
  if (!data.scheduled_publish_at) {
    if (data.scheduled_publish_tz) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduled_publish_at'], message: 'scheduled_publish_at is required when scheduled_publish_tz is set' });
    }
    return;
  }
  if (new Date(data.scheduled_publish_at).getTime() <= Date.now()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduled_publish_at'], message: 'Scheduled publication time must be in the future' });
  }
  if (data.is_internal) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduled_publish_at'], message: 'Only client-visible comments can be scheduled' });
  }
  if (!data.scheduled_publish_tz || !isValidIanaTimeZone(data.scheduled_publish_tz)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduled_publish_tz'], message: 'A valid IANA time zone is required for scheduled comments' });
  }
}

// Ticket comment schemas
export const createTicketCommentSchema = z.object({
  comment_text: z.string()
    .min(1, 'Comment text is required')
    .refine((value) => getVisibleCommentLength(value) > 0, 'Comment text is required')
    .refine(
      (value) => getVisibleCommentLength(value) <= MAX_TICKET_COMMENT_LENGTH,
      `Comment text is too long (max ${MAX_TICKET_COMMENT_LENGTH} characters)`
    ),
  is_internal: z.boolean().optional().default(false),
  is_resolution: z.boolean().optional().default(false),
  time_spent: z.number().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
  parent_comment_id: uuidSchema.optional(),
  external_links: inlineTicketExternalLinksSchema,
  scheduled_publish_at: z.string().datetime({ offset: true }).optional(),
  scheduled_publish_tz: z.string().min(1).max(64).optional(),
  ...ticketNotificationSuppressionSchema,
}).superRefine(validateTicketNotificationSuppression).superRefine(validateScheduledCommentPublication);

export const updateTicketCommentSchema = z.object({
  comment_text: z.string()
    .min(1, 'Comment text is required')
    .refine((value) => getVisibleCommentLength(value) > 0, 'Comment text is required')
    .refine(
      (value) => getVisibleCommentLength(value) <= MAX_TICKET_COMMENT_LENGTH,
      `Comment text is too long (max ${MAX_TICKET_COMMENT_LENGTH} characters)`
    ),
});

export type UpdateTicketCommentData = z.infer<typeof updateTicketCommentSchema>;
export type CreateTicketMaterialData = z.infer<typeof createTicketMaterialSchema>;

export const ticketCommentResponseSchema = z.object({
  comment_id: uuidSchema,
  ticket_id: uuidSchema,
  comment_text: z.string(),
  comment_html: z.string().optional(),
  is_internal: z.boolean(),
  time_spent: z.number().nullable(),
  created_by: uuidSchema.nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().nullable(),
  tenant: uuidSchema,
  contact_id: uuidSchema.nullable().optional(),

  // Threading fields (mobile threaded comments)
  thread_id: uuidSchema.nullable().optional(),
  parent_comment_id: uuidSchema.nullable().optional(),
  deleted_at: z.string().datetime().nullable().optional(),

  // Joined fields
  created_by_name: z.string().nullable().optional(),
  author_contact_id: uuidSchema.nullable().optional(),
  author_contact_name: z.string().nullable().optional(),
  author_contact_email: z.string().nullable().optional()
});

// Ticket bulk operations schemas
export const bulkUpdateTicketSchema = z.object({
  tickets: z.array(z.object({
    ticket_id: uuidSchema,
    data: updateTicketSchema
  })).min(1).max(100)
});

export const bulkAssignTicketSchema = z.object({
  ticket_ids: z.array(uuidSchema).min(1).max(100),
  assigned_to: uuidSchema.optional()
});

export const bulkStatusUpdateSchema = z.object({
  ticket_ids: z.array(uuidSchema).min(1).max(100),
  status_id: uuidSchema
});

// Ticket statistics schema
export const ticketStatsResponseSchema = z.object({
  total_tickets: z.number(),
  open_tickets: z.number(),
  closed_tickets: z.number(),
  overdue_tickets: z.number(),
  unassigned_tickets: z.number(),
  tickets_by_status: z.record(z.number()),
  tickets_by_priority: z.record(z.number()),
  tickets_by_category: z.record(z.number()),
  tickets_by_board: z.record(z.number()),
  average_resolution_time: z.number().nullable(),
  tickets_created_today: z.number(),
  tickets_created_this_week: z.number(),
  tickets_created_this_month: z.number()
});

// Ticket search schema
export const ticketSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  fields: z.union([
    z.array(z.enum(['title', 'ticket_number', 'client_name', 'contact_name'])),
    arrayTransform(z.enum(['title', 'ticket_number', 'client_name', 'contact_name']))
  ]).optional(),
  status_ids: z.union([
    z.array(uuidSchema),
    arrayTransform(uuidSchema)
  ]).optional(),
  priority_ids: z.union([
    z.array(uuidSchema),
    arrayTransform(uuidSchema)
  ]).optional(),
  client_ids: z.union([
    z.array(uuidSchema),
    arrayTransform(uuidSchema)
  ]).optional(),
  assigned_to_ids: z.union([
    z.array(uuidSchema),
    arrayTransform(uuidSchema)
  ]).optional(),
  include_closed: booleanTransform.optional().default("false"),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional().default('25')
});

// Ticket export schema
export const ticketExportQuerySchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx']).optional().default('csv'),
  include_closed: booleanTransform.optional().default("false"),
  include_comments: booleanTransform.optional().default("false"),
  date_range: z.enum(['today', 'week', 'month', 'quarter', 'year', 'custom']).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  fields: z.array(z.string()).optional()
});

// Ticket metrics schema
export const ticketMetricsQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional().default('month'),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  group_by: z.enum(['status', 'priority', 'category', 'board', 'assignee', 'client']).optional()
});

// Asset ticket creation schema
export const createTicketFromAssetSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  priority_id: uuidSchema,
  status_id: uuidSchema,
  board_id: uuidSchema,
  asset_id: uuidSchema,
  client_id: uuidSchema,
  description: z.string().optional(),
  contact_name_id: uuidSchema.optional(),
  category_id: uuidSchema.optional()
});

// Link an asset to a ticket (POST /api/v1/tickets/{id}/assets).
export const linkTicketAssetSchema = z.object({
  asset_id: uuidSchema,
  relationship_type: z.string().min(1).optional(),
  notes: z.string().optional()
});

// Add an additional agent to a ticket (POST /api/v1/tickets/{id}/agents).
export const addTicketAgentSchema = z.object({
  user_id: uuidSchema,
  role: z.string().trim().min(1).max(50).optional(),
  ...ticketNotificationSuppressionSchema,
}).superRefine(validateTicketNotificationSuppression);

const ticketAgentSchema = z.object({
  user_id: uuidSchema,
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable()
});

// GET /api/v1/tickets/{id}/agents response.
export const ticketAgentsResponseSchema = z.object({
  ticket_id: uuidSchema,
  primary_agent: ticketAgentSchema.nullable(),
  additional_agents: z.array(ticketAgentSchema.extend({
    assignment_id: uuidSchema,
    role: z.string().nullable(),
    assigned_at: z.union([z.string(), z.date()]).nullable()
  }))
});

// Assign a team to a ticket (PUT /api/v1/tickets/{id}/team).
export const assignTicketTeamSchema = z.object({
  team_id: uuidSchema,
  ...ticketNotificationSuppressionSchema
}).superRefine(validateTicketNotificationSuppression);

// Remove a ticket's team (DELETE /api/v1/tickets/{id}/team). `mode` decides what
// happens to the additional agents the team assignment created.
export const removeTicketTeamSchema = z.object({
  mode: z.enum(['remove_all', 'keep_all', 'selective']).default('remove_all'),
  keep_user_ids: z.array(uuidSchema).optional()
}).refine(
  (data) => data.mode !== 'selective' || (data.keep_user_ids?.length ?? 0) > 0,
  { path: ['keep_user_ids'], message: 'keep_user_ids is required when mode is selective' }
);

// Export types for TypeScript
export type CreateTicketData = z.infer<typeof createTicketSchema>;
export type UpdateTicketData = z.infer<typeof updateTicketSchema>;
export type TicketFilterData = z.infer<typeof ticketFilterSchema>;
export type TicketResponse = z.infer<typeof ticketResponseSchema>;
export type TicketWithDetailsResponse = z.infer<typeof ticketWithDetailsResponseSchema>;
export type CreateTicketCommentData = z.infer<typeof createTicketCommentSchema>;
export type TicketCommentResponse = z.infer<typeof ticketCommentResponseSchema>;
export type TicketSearchData = z.infer<typeof ticketSearchSchema>;
export type TicketExportQuery = z.infer<typeof ticketExportQuerySchema>;
export type TicketMetricsQuery = z.infer<typeof ticketMetricsQuerySchema>;
export type CreateTicketFromAssetData = z.infer<typeof createTicketFromAssetSchema>;
export type LinkTicketAssetData = z.infer<typeof linkTicketAssetSchema>;
export type AddTicketAgentData = z.infer<typeof addTicketAgentSchema>;
export type TicketAgentsResponse = z.infer<typeof ticketAgentsResponseSchema>;
export type AssignTicketTeamData = z.infer<typeof assignTicketTeamSchema>;
export type RemoveTicketTeamData = z.infer<typeof removeTicketTeamSchema>;
