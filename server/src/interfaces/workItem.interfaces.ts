import { TenantEntity } from ".";

export type WorkItemType = 'ticket' | 'project_task' | 'non_billable_category' | 'ad_hoc';

export interface IWorkItem extends TenantEntity {
  work_item_id: string;
  type: WorkItemType;
  name: string;
  title?: string;
  description: string;
  // is_billable: boolean;
  startTime?: Date;
  endTime?: Date;
  scheduled_start?: string;
  scheduled_end?: string;
}

export interface WorkItemWithStatus extends Omit<IExtendedWorkItem, "tenant"> {
  status: string;
  scheduled_start?: string;
  scheduled_end?: string;
}

export interface IExtendedWorkItem extends IWorkItem {
  // Ticket specific fields
  ticket_number?: string;
  title?: string;
  company_id?: string;
  company_name?: string;
  status_name?: string;
  channel_name?: string;
  assigned_to_name?: string;
  contact_name?: string;
  due_date?: Date | string;
  
  // Project task specific fields
  project_name?: string;
  phase_name?: string;
  task_name?: string;

  // Common fields
  details?: object;
  id?: string;
  schedule_details?: object;
  users?: any[];
  canAssignMultipleAgents?: boolean;
  slot?: {
    start: Date;
    end: Date;
  };
  additional_user_ids?: string[];
  assigned_user_ids?: string[];
  needsDispatch?: boolean;
  agentsNeedingDispatch?: { user_id: string; first_name: string | null; last_name: string | null }[];
}
