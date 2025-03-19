// server/src/interfaces/project.interfaces.ts
import { TenantEntity } from ".";
import { IUserWithRoles } from "./auth.interfaces";
import { ItemType, IStatus, IStandardStatus } from "./status.interface";

export interface IProjectStatusMapping extends TenantEntity {
  project_status_mapping_id: string;
  project_id: string;
  status_id?: string;
  standard_status_id?: string;
  is_standard: boolean;
  custom_name: string | null;
  display_order: number;
  is_visible: boolean;
}


export interface IProject extends TenantEntity {
  project_id: string;
  company_id: string;
  project_name: string;
  description: string | null;
  start_date: Date | null;
  end_date: Date | null;
  created_at: Date;
  updated_at: Date;
  client_name?: string;
  wbs_code: string;
  is_inactive: boolean;
  status: string;
  status_name?: string;
  is_closed?: boolean;
  assigned_to?: string | null;
  assigned_user?: IUserWithRoles | null;
  contact_name?: string | null;
  contact_name_id?: string | null;
  budgeted_hours?: number | null;
}

export interface IProjectPhase extends TenantEntity {
  phase_id: string;
  project_id: string;
  phase_name: string;
  description: string | null;
  start_date: Date | null;
  end_date: Date | null;
  status: string;
  order_number: number;
  created_at: Date;
  updated_at: Date;
  wbs_code: string;  
}

export interface IProjectTask extends TenantEntity {
  task_id: string;
  phase_id: string;
  task_name: string;
  description: string | null;
  assigned_to: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  project_status_mapping_id: string;
  created_at: Date;
  updated_at: Date;
  wbs_code: string;  
  due_date: Date | null;
  checklist_items?: ITaskChecklistItem[];
  ticket_links?: IProjectTicketLinkWithDetails[];
  resources?: any[];
}

export interface IProjectTaskCardInfo extends IProjectTask {
  assigned_to_name: string;
}

export interface IProjectTicketLink extends TenantEntity {
  link_id: string;
  project_id: string;
  phase_id: string | null;
  task_id: string | null;
  ticket_id: string;
  created_at: Date;
}

export interface IProjectTicketLinkWithDetails extends IProjectTicketLink {
  ticket_number: string;
  title: string;
  status_name: string;
  is_closed: boolean;
}

export interface ITaskChecklistItem extends TenantEntity {
  checklist_item_id: string;
  task_id: string;
  item_name: string;
  description: string | null;
  assigned_to: string | null;
  completed: boolean;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
  order_number: number;
}

export type ProjectStatus = {
  project_status_mapping_id: string;
  status_id: string;
  name: string;
  custom_name: string | null;
  is_visible: boolean;
  display_order: number;
  is_standard: boolean;
  is_closed: boolean;
  standard_status_id?: string;
  item_type?: ItemType;
  status_type?: ItemType;
};
