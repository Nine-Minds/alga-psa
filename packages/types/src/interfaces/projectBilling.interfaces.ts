import { TenantEntity } from './index';

export type ProjectBillingModel = 'fixed_price' | 'time_and_materials';
export type ProjectBillingInvoiceMode = 'recurring' | 'standalone';
export type ProjectBillingCapBehavior = 'notify' | 'hard_cap';
export type ProjectBillingDepositTreatment = 'credit' | 'deduct_final';
export type ProjectBillingScheduleEntryType = 'milestone' | 'deposit';
export type ProjectBillingTriggerType = 'phase' | 'date' | 'manual';
export type ProjectBillingScheduleStatus = 'pending' | 'ready' | 'held' | 'approved' | 'invoiced' | 'canceled';

export interface IProjectBillingConfig extends TenantEntity {
  config_id: string;
  project_id: string;
  billing_model: ProjectBillingModel;
  total_price: number | null;
  currency: string | null;
  invoice_mode: ProjectBillingInvoiceMode;
  contract_id: string | null;
  cap_amount: number | null;
  cap_behavior: ProjectBillingCapBehavior | null;
  cap_notify_thresholds: number[];
  deposit_treatment: ProjectBillingDepositTreatment;
  is_taxable: boolean;
  tax_region: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface IProjectBillingScheduleEntry extends TenantEntity {
  schedule_entry_id: string;
  config_id: string;
  entry_type: ProjectBillingScheduleEntryType;
  description: string;
  amount: number | null;
  percentage: number | null;
  trigger_type: ProjectBillingTriggerType;
  phase_id: string | null;
  trigger_date: string | null;
  status: ProjectBillingScheduleStatus;
  ready_at: Date | string | null;
  hold_reason: string | null;
  held_at: Date | string | null;
  held_by: string | null;
  approved_by: string | null;
  approved_at: Date | string | null;
  invoice_id: string | null;
  invoice_charge_id: string | null;
  requires_payment_before_work: boolean;
  display_order: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface IProjectPhaseRateOverride extends TenantEntity {
  rate_override_id: string;
  phase_id: string;
  service_id: string | null;
  rate: number | null;
  override_service_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface IProjectBillingCapUsage extends TenantEntity {
  cap_usage_id: string;
  config_id: string;
  billed_amount: number;
  written_down_amount: number;
  notified_thresholds: number[];
  updated_at: Date | string;
}
