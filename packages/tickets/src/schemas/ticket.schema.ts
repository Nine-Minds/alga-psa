import { z } from 'zod';
import { TICKET_LIST_SORT_KEYS } from '../lib/ticketListSort';
import { ticketWhereSchema } from '../lib/ticketWhere';

export const ticketFormSchema = z.object({
  title: z.string(),
  board_id: z.string().guid(),
  client_id: z.string().guid().nullable(),
  location_id: z.string().guid().nullable().optional(),
  billing_profile_id: z.string().guid().nullable().optional(),
  contact_name_id: z.string().guid().nullable(),
  status_id: z.string().guid(),
  assigned_to: z.string().guid().nullable(),
  priority_id: z.string().guid().nullable(), // Required - used for both custom and ITIL priorities
  description: z.string(),
  category_id: z.string().guid().nullable(),
  subcategory_id: z.string().guid().nullable(),
  // ITIL-specific fields (for priority calculation)
  itil_impact: z.number().int().min(1).max(5).optional(),
  itil_urgency: z.number().int().min(1).max(5).optional(),
  itil_priority_level: z.number().int().min(1).max(5).optional(),
  due_date: z.string().datetime().nullable().optional(),
});

export const createTicketFromAssetSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority_id: z.string().guid(),
  asset_id: z.string().guid(),
  client_id: z.string().guid(),
  /** FR-E8: the asset's assignee, or a shared workspace's single user. */
  contact_name_id: z.string().guid().nullable().optional(),
  /** FR-F2: an explicit pick wins; omitted means "inherit from the asset". */
  billing_profile_id: z.string().guid().nullable().optional(),
});

export const ticketSchema = z.object({
  tenant: z.string().guid().optional(),
  ticket_id: z.string().guid(),
  master_ticket_id: z.string().guid().nullable().optional(),
  ticket_number: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  url: z.string().nullable(),
  board_id: z.string().guid(),
  client_id: z.string().guid().nullable(),
  location_id: z.string().guid().nullable().optional(),
  billing_profile_id: z.string().guid().nullable().optional(),
  contact_name_id: z.string().guid().nullable(),
  status_id: z.string().guid(),
  category_id: z.string().guid().nullable(),
  subcategory_id: z.string().guid().nullable(),
  entered_by: z.string().guid(),
  updated_by: z.string().guid().nullable(),
  closed_by: z.string().guid().nullable(),
  assigned_to: z.string().guid().nullable(),
  assigned_team_id: z.string().guid().nullable().optional(),
  escalated: z.boolean().nullable().optional(),
  escalation_level: z.number().int().min(1).max(3).nullable().optional(),
  escalated_at: z.string().datetime().nullable().optional(),
  escalated_by: z.string().guid().nullable().optional(),
  entered_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  due_date: z.string().datetime().nullable().optional(),
  source: z.string().nullable().optional(),
  ticket_origin: z.string().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).nullable(),
  email_metadata: z.unknown().nullable().optional(),
  priority_id: z.string().guid().nullable(), // Used for both custom and ITIL priorities
  // ITIL-specific fields (for priority calculation)
  itil_impact: z.number().int().min(1).max(5).nullable().optional(),
  itil_urgency: z.number().int().min(1).max(5).nullable().optional(),
  itil_priority_level: z.number().int().min(1).max(5).nullable().optional(),
  // Response state tracking
  response_state: z.enum(['awaiting_client', 'awaiting_internal']).nullable().optional(),
  // Provenance for a ticket created via "Duplicate". Create-only; no FK.
  duplicated_from_ticket_id: z.string().guid().nullable().optional(),
  // Provenance for a ticket created from a ticket template. Create-only; no FK.
  created_from_template_id: z.string().guid().nullable().optional(),
});

export const ticketUpdateSchema = ticketSchema.partial().omit({
  tenant: true,
  ticket_id: true,
  ticket_number: true,
  entered_by: true,
  entered_at: true,
  duplicated_from_ticket_id: true,
  created_from_template_id: true,
  // Server-owned audit columns, stamped by ticketUpdateStamp.
  updated_at: true,
  updated_by: true,
});

export const ticketAttributesQuerySchema = z.object({
  ticketId: z.string().guid(),
});

// Create a base schema for ITicket first
const baseTicketSchema = z.object({
  tenant: z.string().guid().optional(),
  ticket_id: z.string().guid(),
  master_ticket_id: z.string().guid().nullable().optional(),
  ticket_number: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  client_id: z.string().guid().nullable(),
  location_id: z.string().guid().nullable().optional(),
  billing_profile_id: z.string().guid().nullable().optional(),
  contact_name_id: z.string().guid().nullable(),
  closed_by: z.string().guid().nullable(),
  assigned_to: z.string().guid().nullable(),
  assigned_team_id: z.string().guid().nullable().optional(),
  escalated: z.boolean().nullable().optional(),
  escalation_level: z.number().int().min(1).max(3).nullable().optional(),
  escalated_at: z.string().datetime().nullable().optional(),
  escalated_by: z.string().guid().nullable().optional(),
  entered_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  due_date: z.string().datetime().nullable().optional(),
  ticket_origin: z.string().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).nullable(),
  updated_by: z.string().guid().nullable(),
});

// Then extend it for ITicketListItem
export const ticketListItemSchema = baseTicketSchema.extend({
  status_id: z.string().guid().nullable(),
  priority_id: z.string().guid().nullable(),
  board_id: z.string().guid().nullable(),
  category_id: z.string().guid().nullable(),
  subcategory_id: z.string().guid().nullable(),
  entered_by: z.string().guid().nullable(),
  status_name: z.string(),
  priority_name: z.string(),
  priority_color: z.string().optional(),
  board_name: z.string(),
  category_name: z.string(),
  client_name: z.string(),
  entered_by_name: z.string(),
  assigned_to_name: z.string().nullable(),
  bundle_child_count: z.number().int().nonnegative().optional(),
  bundle_open_child_count: z.number().int().nonnegative().optional(),
  bundle_master_ticket_number: z.string().nullable().optional(),
  bundle_distinct_client_count: z.number().int().nonnegative().optional(),
  latest_activity_at: z.string().nullable().optional(),
  latest_activity_actor: z
    .object({
      kind: z.enum(['user', 'client_user', 'service', 'contact', 'email_sender', 'system']),
      name: z.string().nullable(),
    })
    .nullable()
    .optional(),
  // ITIL-specific fields for list items (for priority calculation)
  itil_impact: z.number().int().min(1).max(5).nullable().optional(),
  itil_urgency: z.number().int().min(1).max(5).nullable().optional(),
  itil_priority_level: z.number().int().min(1).max(5).nullable().optional(),
});

export const ticketListFiltersSchema = z.object({
  boardId: z.string().guid().nullish(),
  boardIds: z.array(z.union([z.string().guid(), z.literal('no-board')])).optional(),
  excludeBoardIds: z.array(z.union([z.string().guid(), z.literal('no-board')])).optional(),
  statusId: z.string().optional(),
  priorityId: z.string().optional(),
  categoryId: z.union([z.string().guid(), z.literal('no-category'), z.literal('all')]).nullish(),
  categoryIds: z.array(z.union([z.string().guid(), z.literal('no-category')])).optional(),
  excludeCategoryIds: z.array(z.union([z.string().guid(), z.literal('no-category')])).optional(),
  clientId: z.string().guid().nullish(),
  contactId: z.string().guid().nullish(),
  searchQuery: z.string().optional(),
  boardFilterState: z.enum(['active', 'inactive', 'all']),
  showOpenOnly: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  assignedToIds: z.array(z.string().guid()).optional(),
  assignedTeamIds: z.array(z.string().guid()).optional(),
  includeUnassigned: z.boolean().optional(),
  assignedToMe: z.boolean().optional(),
  // Due date filters
  dueDateFilter: z
    .enum(['all', 'overdue', 'upcoming', 'today', 'no_due_date', 'before', 'after', 'custom'])
    .optional(),
  dueDateFrom: z.string().datetime().optional(),
  dueDateTo: z.string().datetime().optional(),
  responseState: z.enum(['awaiting_client', 'awaiting_internal', 'none', 'all']).optional(),
  slaStatusFilter: z.enum(['all', 'has_sla', 'no_sla', 'on_track', 'breached', 'paused']).optional(),
  sortBy: z.enum(TICKET_LIST_SORT_KEYS).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  bundleView: z.enum(['bundled', 'individual']).optional(),
  where: ticketWhereSchema.optional(),
});
