/**
 * Ticket API Schemas
 * Validation schemas for ticket-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  arrayTransform
} from './common';

// Ticket attributes schema (flexible JSON object)
const ticketAttributesSchema = z.record(z.unknown()).optional();

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
  attributes: ticketAttributesSchema,
  tags: z.array(z.string()).optional()
});

// Update ticket schema (all fields optional)
export const updateTicketSchema = createUpdateSchema(createTicketSchema);

// Ticket status update schema
export const updateTicketStatusSchema = z.object({
  status_id: uuidSchema,
  closed_at: z.string().datetime().optional(),
  closed_by: uuidSchema.optional()
});

// Ticket assignment schema
export const updateTicketAssignmentSchema = z.object({
  assigned_to: uuidSchema.nullable().optional()
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
  is_overdue: booleanTransform.optional(),
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
  board_name: z.string().optional()
});

// Ticket list query schema
export const ticketListQuerySchema = createListQuerySchema(ticketFilterSchema);

// Ticket response schema
export const ticketResponseSchema = z.object({
  ticket_id: uuidSchema,
  ticket_number: z.string(),
  title: z.string(),
  url: z.string().nullable(),
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
  }).optional()
});

// Ticket comment schemas
export const createTicketCommentSchema = z.object({
  comment_text: z.string().min(1, 'Comment text is required'),
  is_internal: z.boolean().optional().default(false),
  time_spent: z.number().min(0).optional()
});

export const ticketCommentResponseSchema = z.object({
  comment_id: uuidSchema,
  ticket_id: uuidSchema,
  comment_text: z.string(),
  is_internal: z.boolean(),
  time_spent: z.number().nullable(),
  created_by: uuidSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().nullable(),
  tenant: uuidSchema,
  
  // Joined fields
  created_by_name: z.string().optional()
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
