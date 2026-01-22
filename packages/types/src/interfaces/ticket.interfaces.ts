// server/src/interfaces/ticket.interfaces.tsx
import { TenantEntity } from ".";
import { ITaggable } from './tag.interfaces';
import { IClientLocation } from "./client.interfaces";
import { IComment } from './comment.interface';
import { IDocument } from './document.interface';

/**
 * Response state tracking for tickets.
 * Tracks who needs to respond next on a ticket:
 * - 'awaiting_client': Support has responded, waiting for client
 * - 'awaiting_internal': Client has responded, waiting for support
 * - null: No response state tracking needed
 */
export type TicketResponseState = 'awaiting_client' | 'awaiting_internal' | null;

export interface ITicket extends TenantEntity, ITaggable {
  ticket_id?: string;
  master_ticket_id?: string | null;
  ticket_number: string;
  title: string;
  url: string | null;
  board_id: string;
  client_id: string | null;
  location_id?: string | null;
  contact_name_id: string | null;
  status_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  entered_by: string;
  updated_by: string | null;
  closed_by: string | null;
  assigned_to: string | null;
  entered_at: string | null; // Changed from Date to string
  updated_at: string | null; // Changed from Date to string
  closed_at: string | null;  // Changed from Date to string
  due_date?: string;         // Optional due date for the ticket
  attributes: Record<string, unknown> | null; // Changed from any to unknown
  priority_id?: string; // Used for both custom and ITIL priorities (unified system)
  estimated_hours?: number;
  location?: IClientLocation; // For populated location data
  // ITIL-specific fields (for priority calculation)
  itil_impact?: number; // 1-5 scale (1 = High, 5 = Low) - used for ITIL priority calculation
  itil_urgency?: number; // 1-5 scale (1 = High, 5 = Low) - used for ITIL priority calculation
  itil_priority_level?: number; // 1-5 calculated ITIL priority based on impact × urgency matrix
  // Response state tracking (who needs to respond next)
  response_state?: TicketResponseState;
  // SLA tracking fields
  sla_policy_id?: string | null;           // The SLA policy applied to this ticket
  sla_started_at?: string | null;          // When the SLA clock started
  sla_response_due_at?: string | null;     // When first response is due
  sla_response_at?: string | null;         // When first response was made
  sla_response_met?: boolean | null;       // Whether response SLA was met
  sla_resolution_due_at?: string | null;   // When resolution is due
  sla_resolution_at?: string | null;       // When ticket was resolved
  sla_resolution_met?: boolean | null;     // Whether resolution SLA was met
  sla_paused_at?: string | null;           // When SLA was paused (null = not paused)
  sla_total_pause_minutes?: number;        // Cumulative pause time in minutes
}

export interface ITicketListItem extends Omit<ITicket, 'status_id' | 'priority_id' | 'board_id' | 'entered_by' | 'category_id' | 'subcategory_id'> {
  status_id: string | null;
  priority_id: string | null;
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  entered_by: string | null;
  status_name: string;
  priority_name: string;
  priority_color?: string;
  board_name: string;
  category_name: string;
  client_name: string;
  entered_by_name: string;
  assigned_to_name: string | null;
  additional_agent_count?: number;
  additional_agents?: { user_id: string; name: string }[];  // Additional agents for tooltip display with avatars
  bundle_child_count?: number;
  bundle_master_ticket_number?: string | null;
  bundle_distinct_client_count?: number;
}

export interface ITicketListFilters {
  boardId?: string;
  statusId?: string;
  priorityId?: string;
  categoryId?: string;
  clientId?: string;
  contactId?: string;
  searchQuery?: string;
  boardFilterState: 'active' | 'inactive' | 'all';
  showOpenOnly?: boolean;
  tags?: string[];
  assignedToIds?: string[];        // Array of user IDs to filter by
  includeUnassigned?: boolean;     // Include tickets with no assignee
  // Due date filters
  dueDateFilter?: 'all' | 'overdue' | 'upcoming' | 'today' | 'no_due_date' | 'before' | 'after' | 'custom';
  dueDateFrom?: string;            // ISO date string for custom range start
  dueDateTo?: string;              // ISO date string for custom range end
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  responseState?: 'awaiting_client' | 'awaiting_internal' | 'none' | 'all';
  bundleView?: 'bundled' | 'individual';
}

export interface IPriority extends TenantEntity {
  priority_id: string;
  priority_name: string;
  order_number: number;
  color: string;
  item_type: 'ticket' | 'project_task';
  created_by: string;
  created_at: Date;
  updated_at?: Date;
  is_from_itil_standard?: boolean;
  itil_priority_level?: number;
}

export interface IStandardPriority {
  priority_id: string;
  priority_name: string;
  order_number: number;
  color: string;
  item_type: 'ticket' | 'project_task';
  created_at: Date;
  updated_at: Date;
}

export interface ITicketStatus {
  status_id: string;
  name: string;
  is_closed: boolean;
}

export interface ITicketCategory extends TenantEntity {
  category_id: string;
  category_name: string;
  parent_category?: string;
  board_id?: string;
  created_by?: string;
  created_at?: Date;
  description?: string;
  display_order?: number;
  is_from_itil_standard?: boolean; // Flag to distinguish ITIL categories from custom categories
}

export interface IAgentSchedule {
  userId: string;
  minutes: number;
}

export interface ITicketWithDetails extends ITicket {
  status_name?: string;
  priority_name?: string;
  priority_color?: string;
  conversations?: IComment[];
  documents?: IDocument[];
  userMap?: Record<string, {
    first_name: string;
    last_name: string;
    user_id: string;
    email?: string;
    user_type: string;
    avatarUrl: string | null;
  }>;
}
