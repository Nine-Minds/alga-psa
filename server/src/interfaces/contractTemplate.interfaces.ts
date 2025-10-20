import { TenantEntity } from './index';
import { ISO8601String } from '../types/types.d';

export type TemplateStatus = 'draft' | 'published' | 'archived';

export interface IContractTemplate extends TenantEntity {
  template_id: string;
  template_name: string;
  template_description?: string | null;
  default_billing_frequency: string;
  template_status: TemplateStatus;
  template_metadata?: Record<string, unknown> | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

export interface IContractTemplateLine extends TenantEntity {
  template_line_id: string;
  template_id: string;
  template_line_name: string;
  description?: string | null;
  billing_frequency: string;
  line_type?: string | null;
  service_category?: string | null;
  is_active: boolean;
  enable_overtime: boolean;
  overtime_rate?: number | null;
  overtime_threshold?: number | null;
  enable_after_hours_rate: boolean;
  after_hours_multiplier?: number | null;
  minimum_billable_time?: number | null;
  round_up_to_nearest?: number | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

export interface IContractTemplateLineMapping extends TenantEntity {
  template_id: string;
  template_line_id: string;
  display_order: number;
  custom_rate?: number | null;
  created_at?: ISO8601String;
}

export interface IContractTemplateWithLines extends IContractTemplate {
  lines: Array<
    Pick<
      IContractTemplateLine,
      | 'template_line_id'
      | 'template_line_name'
      | 'line_type'
      | 'billing_frequency'
      | 'is_active'
      | 'description'
    > & {
      display_order: number;
      custom_rate?: number | null;
    }
  >;
}
