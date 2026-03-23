import type { ISO8601String } from '../lib/temporal';
import { TenantEntity } from './index';

export type AccountingExportStatus =
  | 'pending'
  | 'validating'
  | 'ready'
  | 'delivered'
  | 'posted'
  | 'failed'
  | 'cancelled'
  | 'needs_attention';

export interface AccountingExportBatch extends TenantEntity {
  batch_id: string;
  adapter_type: string;
  target_realm?: string | null;
  export_type: string;
  filters?: Record<string, any> | null;
  status: AccountingExportStatus;
  queued_at: ISO8601String;
  validated_at?: ISO8601String | null;
  delivered_at?: ISO8601String | null;
  posted_at?: ISO8601String | null;
  created_by?: string | null;
  last_updated_by?: string | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
  notes?: string | null;
}

export type AccountingExportLineStatus =
  | 'pending'
  | 'ready'
  | 'delivered'
  | 'posted'
  | 'failed';

export type AccountingExportServicePeriodSource =
  | 'canonical_detail_periods'
  | 'invoice_header_fallback'
  | 'financial_document_fallback';

export interface AccountingExportRecurringDetailPeriod {
  service_period_start?: ISO8601String | null;
  service_period_end?: ISO8601String | null;
  billing_timing?: 'arrears' | 'advance' | null;
}

export interface AccountingExportLinePayload {
  invoice_number?: string;
  invoice_status?: string;
  client_name?: string | null;
  /**
   * Authoritative explanation of how the top-level summary service-period fields were derived.
   * When `canonical_detail_periods`, `recurring_detail_periods` is authoritative and
   * `AccountingExportLine.service_period_start` / `service_period_end` is the compatibility summary range.
   */
  service_period_source?: AccountingExportServicePeriodSource | null;
  recurring_detail_periods?: AccountingExportRecurringDetailPeriod[] | null;
  metadata?: {
    manual_invoice?: boolean;
    manual_charge?: boolean;
    multi_period?: boolean;
    credit_memo?: boolean;
    zero_amount?: boolean;
  } | null;
  transaction_ids?: string[];
}

export interface AccountingExportLine extends TenantEntity {
  line_id: string;
  batch_id: string;
  invoice_id: string;
  invoice_charge_id?: string | null;
  client_id?: string | null;
  amount_cents: number;
  currency_code: string;
  exchange_rate_basis_points?: number | null;
  /** Compatibility summary range for export consumers that cannot represent detail rows one-to-one. */
  service_period_start?: ISO8601String | null;
  /** Compatibility summary range for export consumers that cannot represent detail rows one-to-one. */
  service_period_end?: ISO8601String | null;
  mapping_resolution?: Record<string, any> | null;
  payload?: AccountingExportLinePayload | null;
  status: AccountingExportLineStatus;
  external_document_ref?: string | null;
  notes?: string | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export type AccountingExportErrorResolutionState =
  | 'open'
  | 'pending_review'
  | 'resolved'
  | 'dismissed';

export interface AccountingExportError extends TenantEntity {
  error_id: string;
  batch_id: string;
  line_id?: string | null;
  code: string;
  message: string;
  metadata?: Record<string, any> | null;
  resolution_state: AccountingExportErrorResolutionState;
  created_at: ISO8601String;
  resolved_at?: ISO8601String | null;
}
