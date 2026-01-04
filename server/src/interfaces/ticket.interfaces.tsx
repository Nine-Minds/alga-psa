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
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  responseState?: 'awaiting_client' | 'awaiting_internal' | 'none' | 'all';
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
