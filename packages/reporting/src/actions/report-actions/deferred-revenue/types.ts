/**
 * Shared types for the deferred-revenue / prepaid liability report.
 *
 * All monetary values are minor units (cents) of the row's currency_code.
 * Amounts are grouped per currency and never summed across currencies.
 */

export interface MovementColumns {
  opening: number;
  issued: number;
  applied: number;
  expired: number;
  adjustments: number;
  closing: number;
}

export function emptyMovement(): MovementColumns {
  return { opening: 0, issued: 0, applied: 0, expired: 0, adjustments: 0, closing: 0 };
}

export function addMovement(left: MovementColumns, right: MovementColumns): MovementColumns {
  return {
    opening: left.opening + right.opening,
    issued: left.issued + right.issued,
    applied: left.applied + right.applied,
    expired: left.expired + right.expired,
    adjustments: left.adjustments + right.adjustments,
    closing: left.closing + right.closing,
  };
}

/**
 * Source classification for a credit detail row, mirroring the QBO
 * reachability logic in creditApplicationApplier.resolveNonCreditMemoSource:
 * credits backed by a prepayment invoice or a project-deposit issuance never
 * produce a QBO CreditMemo, so they are flagged qboReachable: false.
 */
export type CreditSourceKind =
  | 'prepayment'
  | 'project_deposit'
  | 'negative_invoice'
  | 'direct_grant'
  | 'transfer_in'
  | 'other';

export interface CreditDetailRow {
  creditId: string;
  transactionId: string;
  clientId: string;
  issuedDate: string;
  description: string | null;
  amount: number;
  remainingAmount: number;
  expirationDate: string | null;
  isExpired: boolean;
  sourceKind: CreditSourceKind;
  qboReachable: boolean;
  invoiceNumber: string | null;
  currencyCode: string;
}

export type FeeSource = 'billed' | 'configured';

export interface BucketDetailRow {
  usageId: string;
  contractLineId: string;
  contractLineName: string;
  serviceId: string;
  serviceName: string;
  periodStart: string;
  periodEnd: string;
  totalMinutes: number;
  rolledOverMinutes: number;
  minutesUsed: number;
  remainingMinutes: number;
  allowRollover: boolean;
  periodFee: number;
  perMinuteRate: number;
  valueRemaining: number;
  feeSource: FeeSource;
  notYetBilled: boolean;
}

export interface ClientRollforward {
  clientId: string;
  clientName: string;
  currencyCode: string;
  credits: MovementColumns;
  hours: MovementColumns;
  total: MovementColumns;
  creditDetails: CreditDetailRow[];
  bucketDetails: BucketDetailRow[];
}

export interface CurrencySection {
  currencyCode: string;
  totals: {
    credits: MovementColumns;
    hours: MovementColumns;
    total: MovementColumns;
  };
  clients: ClientRollforward[];
}

export interface DeferredRevenueReport {
  month: string;
  generatedAt: string;
  sections: CurrencySection[];
  /** Disclosed derivation fallbacks taken (e.g. spanning-period burn attribution). */
  notes: string[];
}
