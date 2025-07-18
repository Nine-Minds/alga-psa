// server/src/interfaces/ticket.interfaces.tsx
import { TenantEntity } from ".";
import { ITaggable } from './tag.interfaces';
import { ICompanyLocation } from "./company.interfaces";

export interface ITicket extends TenantEntity, ITaggable {
  ticket_id?: string;
  ticket_number: string;
  title: string;
  url: string | null;
  channel_id: string;
  company_id: string | null;
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
  priority_id: string;
  estimated_hours?: number;
  location?: ICompanyLocation; // For populated location data
}

export interface ITicketListItem extends Omit<ITicket, 'status_id' | 'priority_id' | 'channel_id' | 'entered_by' | 'category_id' | 'subcategory_id'> {
  status_id: string | null;
  priority_id: string | null;
  channel_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  entered_by: string | null;
  status_name: string;
  priority_name: string;
  priority_color?: string;
  channel_name: string;
  category_name: string;
  company_name: string;
  entered_by_name: string;
  assigned_to_name: string | null;
}

export interface ITicketListFilters {
  channelId?: string;
  statusId?: string;
  priorityId?: string;
  categoryId?: string;
  companyId?: string;
  contactId?: string;
  searchQuery?: string;
  channelFilterState: 'active' | 'inactive' | 'all';
  showOpenOnly?: boolean;
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
  channel_id?: string;
  created_by?: string;
  created_at?: Date;
  description?: string;
  display_order?: number;
}

export interface IAgentSchedule {
  userId: string;
  minutes: number;
}
