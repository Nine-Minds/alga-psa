import type { IClientPortalConfig } from '@alga-psa/types';

export interface TemplateStatusMapping {
  temp_id: string;
  status_id?: string;
  custom_status_name?: string;
  custom_status_color?: string;
  display_order: number;
}

export interface TemplatePhase {
  temp_id: string;
  phase_name: string;
  description?: string;
  duration_days?: number;
  start_offset_days: number;
  order_number: number;
}

export interface TemplateTask {
  temp_id: string;
  phase_temp_id: string;
  task_name: string;
  description?: string;
  estimated_hours?: number;
  duration_days?: number;
  task_type_key?: string;
  priority_id?: string;
  assigned_to?: string;
  additional_agents?: string[];
  template_status_mapping_id?: string;
  service_id?: string;
  order_number: number;
}

export interface TemplateChecklistItem {
  temp_id: string;
  task_temp_id: string;
  item_name: string;
  description?: string;
  order_number: number;
  completed: boolean;
}

export interface TemplateWizardData {
  template_name: string;
  description?: string;
  category?: string;
  status_mappings: TemplateStatusMapping[];
  phases: TemplatePhase[];
  tasks: TemplateTask[];
  checklist_items: TemplateChecklistItem[];
  client_portal_config?: IClientPortalConfig;
}

