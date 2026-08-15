import type { TenantEntity } from './index';

/**
 * Ad-hoc prepaid hour blocks — a client-level, minutes-denominated ledger for
 * one-time hour blocks (non-recurring, stackable, FIFO by expiration-then-
 * purchase). See docs/plans/2026-08-13-ad-hoc-prepaid-hour-blocks-plan.md.
 */

export type HourBlockStatus = 'pending' | 'active' | 'expired' | 'voided';

export type HourBlockAuditType =
  | 'purchase'
  | 'grant'
  | 'adjustment'
  | 'expiration_date_change'
  | 'manual_expiration'
  | 'auto_expiration'
  | 'void';

export interface IHourBlock extends TenantEntity {
  block_id: string;
  tenant: string;
  client_id: string;
  /** Catalog service the block is sold as (tax/GL/invoice description) — distinct from burn scope. */
  service_id: string;
  /** Purchased size in minutes. */
  total_minutes: number;
  /** Draw-down balance; maintained transactionally. */
  remaining_minutes: number;
  /** Cents per hour agreed at purchase. */
  hourly_rate: number;
  /** Cents; hours × hourly_rate at creation (0 for grants unless a value is recorded). */
  purchase_amount: number;
  currency_code: string;
  status: HourBlockStatus;
  /** Set on activation (invoice finalize / grant). */
  purchased_at?: string | null;
  /**
   * Instant of the first allocation ever recorded against the block. Set once
   * at the first burn and NEVER cleared — not by reversal, not by reconcile,
   * not by entry edit churn — so the void guard can reject any block that has
   * ever been used even after its allocation rows are gone.
   */
  first_allocated_at?: string | null;
  expiration_date?: string | null;
  /** Null ⇒ direct grant. */
  source_invoice_id?: string | null;
  /**
   * Immutable origin of the block — 'purchase' (via an invoice) or 'grant'
   * (comped hours, no invoice). Set at mint time and never cleared: it keeps
   * purchase provenance even when the source invoice is later deleted, so the
   * UI can distinguish "purchase, invoice deleted" from a true grant.
   */
  source_type?: 'purchase' | 'grant';
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  created_by?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string;
  // Joins populated by list/detail actions.
  service_name?: string;
  invoice_number?: string;
  scope_service_ids?: string[];
  /** Dollar value remaining in minor units (remaining_minutes/60 × hourly_rate). */
  remaining_value?: number;
  /** True when the block has EVER been allocated (void guard; derived from `first_allocated_at IS NOT NULL`, not live allocation rows). */
  has_allocations?: boolean;
}

export interface IHourBlockServiceScope extends TenantEntity {
  block_id: string;
  service_id: string;
  created_at: string;
  // Join populated by the list/detail actions.
  service_name?: string;
}

export interface IHourBlockAllocation extends TenantEntity {
  allocation_id: string;
  block_id: string;
  time_entry_id: string;
  minutes: number;
  created_at: string;
  // Joins populated by detail queries.
  work_item_title?: string;
  work_item_type?: string;
  entry_date?: string | null;
  user_name?: string;
}

export interface IHourBlockAuditEntry extends TenantEntity {
  audit_id: string;
  block_id: string;
  type: HourBlockAuditType;
  minutes_delta?: number | null;
  reason?: string | null;
  created_by?: string | null;
  metadata?: Record<string, any> | null;
  created_at: string;
  // Joins populated by detail queries.
  created_by_name?: string;
}

export interface IHourBlockPurchaseInput {
  clientId: string;
  serviceId: string;
  hours: number;
  hourlyRate: number;
  expirationDate?: string | null;
  scopeServiceIds?: string[];
  notes?: string;
}

export interface IHourBlockGrantInput {
  clientId: string;
  serviceId: string;
  hours: number;
  hourlyRate?: number;
  expirationDate?: string | null;
  scopeServiceIds?: string[];
  reason: string;
  notes?: string;
}
