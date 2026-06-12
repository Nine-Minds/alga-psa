export type SyncOperationType =
  | 'export_invoice'
  | 'export_credit_memo'
  | 'apply_credit'
  | 'record_payment'
  | 'void_invoice';

export type SyncOperationStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';

export interface AccountingSyncOperation {
  op_id: string;
  tenant: string;
  adapter_type: string;
  target_realm: string | null;
  operation: SyncOperationType;
  alga_entity_type: string;
  alga_entity_id: string;
  status: SyncOperationStatus;
  attempts: number;
  last_error: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  processed_at: string | null;
}

export interface EnqueueSyncOperationInput {
  tenant: string;
  adapterType: string;
  targetRealm?: string | null;
  operation: SyncOperationType;
  algaEntityType: string;
  algaEntityId: string;
  payload?: Record<string, unknown> | null;
}

export type SyncCycleStatus = 'running' | 'succeeded' | 'failed' | 'aborted';

export interface AccountingSyncCycleStats {
  paymentsApplied: number;
  paymentsReversed: number;
  paymentsSkipped: number;
  driftFound: number;
  customersUpdated: number;
  opsProcessed: number;
  opsFailed: number;
  unmappedIgnored: number;
  exceptionsCreated: number;
  refundReceiptsSeen: number;
  truncated: boolean;
}

export function emptyCycleStats(): AccountingSyncCycleStats {
  return {
    paymentsApplied: 0,
    paymentsReversed: 0,
    paymentsSkipped: 0,
    driftFound: 0,
    customersUpdated: 0,
    opsProcessed: 0,
    opsFailed: 0,
    unmappedIgnored: 0,
    exceptionsCreated: 0,
    refundReceiptsSeen: 0,
    truncated: false
  };
}

export interface AccountingSyncCycleRecord {
  cycle_id: string;
  tenant: string;
  adapter_type: string;
  target_realm: string;
  status: SyncCycleStatus;
  started_at: string;
  finished_at: string | null;
  cursor_before: string | null;
  cursor_after: string | null;
  stats: AccountingSyncCycleStats | null;
  error: string | null;
}

/** Mapping-ledger sync_status values used by the sync engine. */
export const MAPPING_SYNC_STATUS = {
  synced: 'synced',
  drift: 'drift',
  externalVoided: 'external_voided',
  voided: 'voided'
} as const;
