import { z } from 'zod';

/**
 * Ticket entity representing a support/service ticket
 */
export interface Ticket {
  ticket_id: string;
  tenant: string;
  ticket_number: string;
  title: string;
  url: string | null;
  board_id: string;
  company_id: string | null;
  location_id: string | null;
  contact_name_id: string | null;
  status_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  channel_id: string | null;
  assigned_to: string | null;
  entered_by: string;
  updated_by: string | null;
  closed_by: string | null;
  description: string | null;
  entered_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  is_closed: boolean;
  attributes: Record<string, unknown> | null;
  estimated_hours: number | null;
  // ITIL-specific fields
  itil_impact: number | null;
  itil_urgency: number | null;
  itil_priority_level: number | null;
  tags?: string[];
}

/**
 * Ticket status configuration
 */
export interface TicketStatus {
  status_id: string;
  tenant: string;
  name: string;
  is_closed: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Ticket priority configuration
 */
export interface TicketPriority {
  priority_id: string;
  tenant: string;
  priority_name: string;
  order_number: number;
  color: string;
  item_type: 'ticket' | 'project_task';
  created_by: string;
  created_at: Date;
  updated_at: Date;
  is_from_itil_standard: boolean;
  itil_priority_level: number | null;
}

/**
 * Ticket channel (email, phone, portal, etc.)
 */
export interface TicketChannel {
  channel_id: string;
  tenant: string;
  channel_name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Ticket category configuration
 */
export interface TicketCategory {
  category_id: string;
  tenant: string;
  category_name: string;
  parent_category: string | null;
  board_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  description: string | null;
  display_order: number | null;
  is_from_itil_standard: boolean;
}

/**
 * Input schema for creating a new ticket
 */
export const createTicketSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().nullable().optional(),
  board_id: z.string().uuid(),
  company_id: z.string().uuid().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
  contact_name_id: z.string().uuid().nullable().optional(),
  status_id: z.string().uuid(),
  category_id: z.string().uuid().nullable().optional(),
  subcategory_id: z.string().uuid().nullable().optional(),
  priority_id: z.string().uuid().nullable().optional(),
  channel_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  url: z.string().url().nullable().optional(),
  attributes: z.record(z.unknown()).nullable().optional(),
  estimated_hours: z.number().positive().nullable().optional(),
  itil_impact: z.number().min(1).max(5).nullable().optional(),
  itil_urgency: z.number().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().uuid()).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/**
 * Input schema for updating an existing ticket
 */
export const updateTicketSchema = createTicketSchema.partial().extend({
  ticket_id: z.string().uuid(),
});

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

/**
 * Filters for querying tickets
 */
export interface TicketFilters {
  search?: string;
  board_id?: string;
  status_id?: string;
  priority_id?: string;
  category_id?: string;
  company_id?: string;
  contact_name_id?: string;
  assigned_to?: string;
  channel_id?: string;
  is_closed?: boolean;
  tags?: string[];
  show_open_only?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: keyof Ticket;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Paginated response for ticket queries
 */
export interface TicketListResponse {
  tickets: Ticket[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Ticket list item with joined data for display
 */
export interface TicketListItem extends Omit<Ticket, 'status_id' | 'priority_id' | 'board_id' | 'entered_by' | 'category_id' | 'subcategory_id'> {
  status_id: string | null;
  priority_id: string | null;
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  entered_by: string | null;
  status_name: string;
  priority_name: string;
  priority_color: string | null;
  board_name: string;
  category_name: string;
  company_name: string;
  entered_by_name: string;
  assigned_to_name: string | null;
}
