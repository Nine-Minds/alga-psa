import type { TenantEntity } from './index';

/**
 * Prepaid Block contract line. A Prepaid Block line is an `Hourly` contract line
 * plus one `contract_line_prepaid_blocks` row; there is no new contract_line_type.
 * Blocks themselves live in the hour-block ledger (see hourBlock.interfaces.ts).
 * See docs/plans/2026-10-13-prepaid-block-invoicing-plan.md.
 */

/** Replenishment tiers available to a block line (the shared tiers minus `notify`). */
export type PrepaidBlockReplenishmentTier = 'draft' | 'auto_issue';

/**
 * When blocks are issued.
 *  - 'consumption' (default): trigger-driven issuances (exhaustion, threshold, expiry, renewal).
 *  - 'cadence': one block per service period of the line's cadence, billed in
 *    advance; the consumption triggers and expiry_months do not apply.
 */
export type PrepaidBlockIssueMode = 'consumption' | 'cadence';

export const PREPAID_BLOCK_ISSUE_MODES = ['consumption', 'cadence'] as const satisfies readonly PrepaidBlockIssueMode[];

/** Maximum rollover_periods (DB CHECK 0..12). */
export const PREPAID_BLOCK_MAX_ROLLOVER_PERIODS = 12;

export interface IPrepaidBlockConfigFields {
  /** Defaults to 'consumption'. Persisted rows always carry it. */
  issue_mode?: PrepaidBlockIssueMode;
  /**
   * Cadence mode only: a block stays valid for its own service period plus this
   * many further periods of the line's cadence (0..12). Must be 0 otherwise.
   */
  rollover_periods?: number;
  /** Block size in minutes (> 0). */
  block_minutes: number;
  /** Price in minor units of the contract currency. */
  block_price: number;
  /** Null = never expires. 1-120 otherwise. */
  expiry_months?: number | null;
  trigger_on_exhaustion: boolean;
  /** 1-99, null = no threshold trigger. */
  trigger_threshold_percent?: number | null;
  /** Must be false when expiry_months is null. */
  trigger_on_expiry: boolean;
  trigger_on_renewal: boolean;
  replenishment_tier: PrepaidBlockReplenishmentTier;
}

/** contract_line_prepaid_blocks: 1:1 config overlay on an Hourly contract line. */
export interface IContractLinePrepaidBlock extends TenantEntity, IPrepaidBlockConfigFields {
  issue_mode: PrepaidBlockIssueMode;
  rollover_periods: number;
  contract_line_id: string;
  /** Catalog service the block invoice line is sold as; one of the line's services. */
  sold_as_service_id: string | null;
  created_at: string;
  updated_at: string;
}

/** contract_template_line_prepaid_blocks. */
export interface IContractTemplateLinePrepaidBlock extends TenantEntity, IPrepaidBlockConfigFields {
  issue_mode: PrepaidBlockIssueMode;
  rollover_periods: number;
  template_line_id: string;
  sold_as_service_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** contract_line_preset_prepaid_blocks. */
export interface IContractLinePresetPrepaidBlock extends TenantEntity, IPrepaidBlockConfigFields {
  issue_mode: PrepaidBlockIssueMode;
  rollover_periods: number;
  preset_id: string;
  sold_as_service_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractLineBlockIssuanceTriggerKind =
  | 'contract_start'
  | 'exhaustion'
  | 'threshold'
  | 'expiry'
  | 'renewal'
  | 'manual';

export type ContractLineBlockIssuanceStatus = 'scheduled' | 'invoiced' | 'superseded' | 'cancelled';

/** contract_line_block_issuances: "a block is due on date X for line L". */
export interface IContractLineBlockIssuance extends TenantEntity {
  issuance_id: string;
  contract_line_id: string;
  client_contract_id: string;
  client_id: string;
  trigger_kind: ContractLineBlockIssuanceTriggerKind;
  /** ISO date (YYYY-MM-DD). */
  due_date: string;
  status: ContractLineBlockIssuanceStatus;
  /** Block whose exhaustion/expiry triggered this issuance. */
  source_block_id?: string | null;
  /** Set when invoiced. */
  block_id?: string | null;
  invoice_id?: string | null;
  invoice_charge_id?: string | null;
  /** Set for usage-triggered issuances. */
  alert_id?: string | null;
  /** Snapshot taken at invoicing. */
  block_minutes?: number | null;
  block_price?: number | null;
  currency_code?: string | null;
  cancel_reason?: string | null;
  created_at: string;
  updated_at: string;
}
