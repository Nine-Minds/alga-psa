import { TenantEntity } from './index';
import type { ISO8601String } from '../lib/temporal';
import type { CadenceOwner } from './recurringTiming.interfaces';

/**
 * Contract status types
 */
export type ContractStatus = 'active' | 'draft' | 'terminated' | 'expired' | 'published' | 'archived';
export type RenewalWorkItemStatus = 'pending' | 'renewing' | 'non_renewing' | 'snoozed' | 'completed';

/**
 * Interface for a Contract
 * Represents a client-owned instantiated contract header that owns contract lines.
 * Reusable contract-definition behavior lives in contract templates, not non-template contracts.
 */
export interface IContract extends TenantEntity {
  contract_id: string;
  contract_name: string;
  contract_description?: string | null;
  owner_client_id?: string | null;
  billing_frequency: string;
  currency_code: string;
  is_active: boolean;
  status: ContractStatus;
  is_template?: boolean;
  template_metadata?: Record<string, unknown> | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Extended contract interface with client information for list views
 */
export interface IContractWithClient extends IContract {
  client_id?: string;
  client_name?: string;
  owner_client_name?: string | null;
  client_contract_id?: string;
  assignment_status?: ContractStatus;
  contract_header_status?: ContractStatus;
  start_date?: ISO8601String;
  end_date?: ISO8601String | null;
  /** Provenance-only metadata for template origin; not a runtime identity key. */
  template_contract_id?: string | null;
  template_contract_name?: string | null;
}

/**
 * Interface for mapping contract lines to contracts
 * Represents the many-to-many relationship between contract lines and their parent contracts.
 */
export interface IContractLineMapping extends TenantEntity {
  contract_id: string;
  contract_line_id: string;
  display_order?: number;
  custom_rate?: number | null;
  billing_timing?: 'arrears' | 'advance';
  cadence_owner?: CadenceOwner;
  created_at?: ISO8601String;
}

/**
 * Interface for associating contracts with clients
 * Represents the assignment of a contract to a client.
 */
export interface IClientContract extends TenantEntity {
  client_contract_id: string;
  client_id: string;
  contract_id: string;
  assignment_status?: ContractStatus;
  contract_status?: ContractStatus;
  /** Provenance-only metadata for template origin; not a runtime identity key. */
  template_contract_id?: string | null;
  billing_frequency?: string;
  start_date: ISO8601String;
  end_date: ISO8601String | null;
  renewal_mode?: 'none' | 'manual' | 'auto';
  notice_period_days?: number;
  renewal_term_months?: number;
  use_tenant_renewal_defaults?: boolean;
  effective_renewal_mode?: 'none' | 'manual' | 'auto';
  effective_notice_period_days?: number;
  evergreen_review_anchor_date?: ISO8601String | null;
  decision_due_date?: ISO8601String | null;
  renewal_cycle_start?: ISO8601String | null;
  renewal_cycle_end?: ISO8601String | null;
  renewal_cycle_key?: string;
  days_until_due?: number;
  is_active: boolean;
  po_required?: boolean;
  po_number?: string | null;
  po_amount?: number | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Renewal queue work item model for a client contract cycle
 */
export interface IClientContractRenewalWorkItem extends TenantEntity {
  renewal_work_item_id: string;
  client_contract_id: string;
  client_id: string;
  contract_id: string;
  decision_due_date: ISO8601String;
  cycle_start?: ISO8601String | null;
  cycle_end?: ISO8601String | null;
  cycle_key: string;
  status: RenewalWorkItemStatus;
  assigned_to?: string | null;
  snoozed_until?: ISO8601String | null;
  created_ticket_id?: string | null;
  created_draft_contract_id?: string | null;
  last_action?: string | null;
  last_action_by?: string | null;
  last_action_at?: ISO8601String | null;
  last_action_note?: string | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Lightweight summary of client assignments for a contract detail view
 */
export interface IContractAssignmentSummary extends TenantEntity {
  client_contract_id: string;
  client_id: string;
  client_name?: string | null;
  assignment_status?: ContractStatus;
  start_date: ISO8601String | null;
  end_date: ISO8601String | null;
  renewal_mode?: 'none' | 'manual' | 'auto';
  notice_period_days?: number;
  renewal_term_months?: number;
  use_tenant_renewal_defaults?: boolean;
  effective_renewal_mode?: 'none' | 'manual' | 'auto';
  effective_notice_period_days?: number;
  decision_due_date?: ISO8601String | null;
  is_active: boolean;
  po_required: boolean;
  po_number?: string | null;
  po_amount?: number | null;
}

/**
 * Interface for contract pricing schedules
 * Represents time-based pricing changes for a contract
 */
export interface IContractPricingSchedule extends TenantEntity {
  schedule_id: string;
  contract_id: string;
  effective_date: ISO8601String;
  end_date?: ISO8601String | null;
  duration_value?: number;
  duration_unit?: 'days' | 'weeks' | 'months' | 'years';
  custom_rate?: number;
  notes?: string;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
  created_by?: string;
  updated_by?: string;
}
