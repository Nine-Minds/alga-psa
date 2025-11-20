import { TenantEntity } from "./index";
import { DependencyType } from "./project.interfaces";

export interface IProjectTemplate extends TenantEntity {
  template_id: string;
  template_name: string;
  description?: string;
  category?: string;

  created_by: string;
  created_at: Date;
  updated_at?: Date;

  use_count: number;
  last_used_at?: Date;
}

export interface IProjectTemplatePhase extends TenantEntity {
  template_phase_id: string;
  template_id: string;
  phase_name: string;
  description?: string;
  duration_days?: number;
  start_offset_days: number;
  order_key?: string;
}

export interface IProjectTemplateTask extends TenantEntity {
  template_task_id: string;
  template_phase_id: string;
  task_name: string;
  description?: string;
  estimated_hours?: number;
  duration_days?: number;
  task_type_key?: string;
  priority_id?: string;
  order_key?: string;
}

export interface IProjectTemplateDependency extends TenantEntity {
  template_dependency_id: string;
  template_id: string;
  predecessor_task_id: string;
  successor_task_id: string;
  dependency_type: DependencyType;
  lead_lag_days: number;
  notes?: string;
}

export interface IProjectTemplateChecklistItem extends TenantEntity {
  template_checklist_id: string;
  template_task_id: string;
  item_name: string;
  description?: string;
  order_number: number;
}

export interface IProjectTemplateStatusMapping extends TenantEntity {
  template_status_mapping_id: string;
  template_id: string;
  status_id?: string;
  custom_status_name?: string;
  display_order: number;
}

export interface IProjectTemplateWithDetails extends IProjectTemplate {
  phases?: IProjectTemplatePhase[];
  tasks?: IProjectTemplateTask[];
  dependencies?: IProjectTemplateDependency[];
  checklist_items?: IProjectTemplateChecklistItem[];
  status_mappings?: IProjectTemplateStatusMapping[];
}
