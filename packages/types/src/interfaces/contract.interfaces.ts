import { TenantEntity } from './index';
import type { ISO8601String } from '../lib/temporal';
import type { CadenceOwner } from './recurringTiming.interfaces';

/**
 * Contract status types
 */
export type ContractStatus = 'active' | 'draft' | 'terminated' | 'expired' | 'published' | 'archived';
/**
 * Derived (never stored) assignment lifecycle status: ContractStatus plus `scheduled`, a confirmed
 * contract whose assignment starts after today. See shared/billingClients/clientContractStatus.ts.
 * Kept out of ContractStatus so the contracts.status column/enum is unaffected.
 */
export type ClientContractDerivedStatus = ContractStatus | 'scheduled';
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
  is_system_managed_default?: boolean;
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
  /** Real uploaded client logo URL (batched); null when none. */
  logoUrl?: string | null;
  owner_client_name?: string | null;
  client_contract_id?: string;
  assignment_status?: ClientContractDerivedStatus;
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
  /**
   * Who owns `custom_rate`. `inherited` (custom_rate NULL) follows the catalog;
   * `custom`/`unreviewed` take the stored number. See the rate-provenance plan.
   */
  rate_provenance?: 'custom' | 'inherited' | 'unreviewed' | null;
  billing_timing?: 'arrears' | 'advance';
  cadence_owner?: CadenceOwner;
  location_id?: string | null;
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
  assignment_status?: ClientContractDerivedStatus;
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
  renewal_due_date_action_policy?: 'queue_only' | 'create_ticket' | null;
  renewal_ticket_board_id?: string | null;
  renewal_ticket_status_id?: string | null;
  renewal_ticket_priority?: string | null;
  renewal_ticket_assignee_id?: string | null;
  effective_renewal_mode?: 'none' | 'manual' | 'auto';
  effective_notice_period_days?: number;
  evergreen_review_anchor_date?: ISO8601String | null;
  decision_due_date?: ISO8601String | null;
  renewal_cycle_start?: ISO8601String | null;
  renewal_cycle_end?: ISO8601String | null;
  renewal_cycle_key?: string;
  days_until_due?: number;
  is_active: boolean;
  /**
   * Billing profile this contract bills to — step 3 of the charge-attribution
   * chain. NULL falls through to the client default, the pre-profile behaviour.
   */
  billing_profile_id?: string | null;
  po_required?: boolean;
  po_number?: string | null;
  po_amount?: number | null;
  /** The assigned contract's own currency (the PO amount is denominated in it). */
  currency_code?: string | null;
  /** true = this contract's charges are excluded from credit draw-down. */
  credit_drawdown_opt_out?: boolean | null;
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
  /** Profile this assignment bills; NULL falls back to the client default. */
  billing_profile_id?: string | null;
  billing_profile_name?: string | null;
  assignment_status?: ClientContractDerivedStatus;
  start_date: ISO8601String | null;
  end_date: ISO8601String | null;
  renewal_mode?: 'none' | 'manual' | 'auto';
  notice_period_days?: number;
  renewal_term_months?: number;
  use_tenant_renewal_defaults?: boolean;
  renewal_due_date_action_policy?: 'queue_only' | 'create_ticket' | null;
  renewal_ticket_board_id?: string | null;
  renewal_ticket_status_id?: string | null;
  renewal_ticket_priority?: string | null;
  renewal_ticket_assignee_id?: string | null;
  effective_renewal_mode?: 'none' | 'manual' | 'auto';
  effective_notice_period_days?: number;
  decision_due_date?: ISO8601String | null;
  is_active: boolean;
  po_required: boolean;
  po_number?: string | null;
  po_amount?: number | null;
  /** true = this contract's charges are excluded from credit draw-down. */
  credit_drawdown_opt_out?: boolean | null;
}

/**
 * Interface for contract pricing schedules
 * Represents time-based pricing changes for a contract
 */
export interface IContractPricingSchedule extends TenantEntity {
  schedule_id: string;
  contract_id: string;
  /**
   * Optional line scope. NULL keeps the original contract-wide meaning (the
   * schedule applies to every line on the contract); a line id scopes the
   * override to that line only.
   */
  contract_line_id?: string | null;
  effective_date: ISO8601String;
  end_date?: ISO8601String | null;
  duration_value?: number;
  duration_unit?: 'days' | 'weeks' | 'months' | 'years';
  /** Integer minor-unit amount; explicit null clears the rate back to the contract default. */
  custom_rate?: number | null;
  notes?: string;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
  created_by?: string;
  updated_by?: string;
}

/**
 * Billing traceability for a live contract: which billing profile(s) bill it,
 * what payment terms apply, and which level of the engine's own chains
 * produced each value. Resolved live at read time — never stored on the
 * contract — through `resolveChargeProfile`, `resolveEffectiveBillingIdentity`
 * and `paymentTermDays`, so it cannot disagree with invoice generation.
 */
export type ContractBillingTraceProfileSource = 'contract_line' | 'contract' | 'work_item' | 'client_default';

/** Where a value inside the winning profile's identity came from. */
export type ContractBillingTraceValueSource = 'profile' | 'client' | 'default' | 'contract';

/**
 * Where the applied payment terms came from, in the engine's inheritance order:
 * the billing profile, the client, the tenant default, then `default` (the
 * system Net 30 fallback when no tier holds a known key).
 */
export type ContractBillingTraceTermsSource = 'profile' | 'client' | 'tenant' | 'default';

export interface ContractBillingTraceTerms {
  /**
   * Known terms key that applies (`net_30` when nothing is configured). Mirrors
   * `PAYMENT_TERMS` in `shared/billingClients/paymentPreferences`; a compile-time
   * check there keeps the two in step.
   */
  value: 'net_30' | 'net_15' | 'net_14' | 'net_7' | 'due_on_receipt';
  source: ContractBillingTraceTermsSource;
  days: number;
  /** Worked example: an invoice dated `asOf` is due on `dueDate`. */
  dueDateExample: { invoiceDate: ISO8601String; dueDate: ISO8601String };
}

export interface ContractBillingTraceField {
  key:
    | 'bill_to'
    | 'payment_method'
    | 'tax_exemption'
    | 'tax_region'
    | 'delivery'
    | 'template'
    | 'po_number'
    | 'currency'
    | 'cadence'
    | 'profile_billing_cycle';
  /** Authored English label; UI surfaces translate by `key`. */
  label: string;
  /** Null when the field has no value of its own (e.g. tax region is a chain, not a value). */
  value: string | null;
  source: ContractBillingTraceValueSource;
  /** False for values the engine does not read (the profile billing cycle). */
  applied?: boolean;
}

/**
 * Why the profile a charge is attributed to differs from the profile whose
 * invoice carries it (decided by `resolveInvoiceProfileForAttribution`).
 */
export type ContractBillingTraceInvoiceReason =
  /** Same profile: attributed to the one whose invoice carries the charge. */
  | 'same_profile'
  /** The attributed profile bills separately: it keeps its own invoice. */
  | 'own_invoice'
  /** The attributed profile does not bill separately (or is inactive): charges roll up to the default. */
  | 'not_billed_separately';

/** The profile whose invoice carries the charges; its terms stamp the due date. */
export interface ContractBillingTraceInvoiceProfile {
  billingProfileId: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface ContractBillingTraceProfile {
  /** The profile the charges are attributed to (`resolveChargeProfile`). */
  billingProfileId: string;
  name: string;
  /** The highest-priority chain step that routes at least one line here. */
  source: ContractBillingTraceProfileSource;
  lineCount: number;
  isActive: boolean;
  isDefault: boolean;
  /** The profile whose invoice these charges land on. Equals the attributed profile only when `invoiceReason` is `same_profile` or `own_invoice`. */
  invoiceProfile: ContractBillingTraceInvoiceProfile;
  invoiceReason: ContractBillingTraceInvoiceReason;
  /** Terms and due date of the INVOICE profile, not the attributed profile. */
  terms: ContractBillingTraceTerms;
  /** Identity fields of the invoice profile (the invoice reads bill-to, PO, delivery from it). */
  fields: ContractBillingTraceField[];
}

export type ContractBillingTraceWarning =
  | { code: 'inactive_profile'; billingProfileId: string; profileName: string }
  /**
   * `profileCount` = distinct attributed profiles; `invoiceProfileCount` = distinct
   * invoice profiles among them. Terms differ per profile only when the latter is > 1.
   */
  | { code: 'mixed_profiles'; profileCount: number; invoiceProfileCount: number; invoiceProfileName: string | null }
  | { code: 'line_override'; contractLineId: string; contractLineName: string | null; billingProfileId: string; profileName: string }
  /**
   * Hourly lines with no line or contract profile follow the work item's profile
   * (ticket/project) when one is set, else the client default. `candidateProfiles`
   * are the profiles the client's work items carry today (may be empty).
   * `bucketCoverage`: a reachable line has bucket-pool or prepaid-block coverage. Time
   * drawn from a bucket pool bills through the line's own assignments; prepaid-block
   * minutes are already paid for. Only the remaining hourly time follows the work item.
   */
  | {
      code: 'work_item_override_possible';
      contractLineIds: string[];
      candidateProfiles: Array<{ billingProfileId: string; name: string }>;
      bucketCoverage: boolean;
    };

export interface ContractBillingTrace {
  asOf: ISO8601String;
  /** Every profile that actually bills a line of this contract, primary first. */
  profiles: ContractBillingTraceProfile[];
  /** Terms of the primary (first) profile's INVOICE profile. With `mixed_profiles`, read `profiles[].terms`. */
  terms: ContractBillingTraceTerms;
  /** Fields of the primary (first) profile. With `mixed_profiles`, read `profiles[].fields`. */
  fields: ContractBillingTraceField[];
  warnings: ContractBillingTraceWarning[];
  /**
   * Conditional outcomes (source `work_item`): profiles the client's tickets or
   * projects carry, billing only the lines named by `work_item_override_possible`.
   * Never part of `profiles[]`; absent when there are none.
   */
  workItemProfiles?: ContractBillingTraceProfile[];
}
