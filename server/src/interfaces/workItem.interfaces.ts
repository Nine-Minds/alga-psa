import { TenantEntity } from ".";

export type WorkItemType = 'ticket' | 'project_task' | 'non_billable_category';

export interface IWorkItem extends TenantEntity {
  work_item_id: string;
  type: WorkItemType;
  name: string;
  description: string;
  is_billable: boolean;
}

export interface IExtendedWorkItem extends IWorkItem {
  // Ticket specific fields
  ticket_number?: string;
  title?: string;
  
  // Project task specific fields
  project_name?: string;
  phase_name?: string;
  task_name?: string;
}
