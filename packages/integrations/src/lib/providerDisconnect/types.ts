/**
 * Durable provider-disconnect state machine for QuickBooks Online and Xero.
 *
 * Disconnect is a persisted, per-target workflow: credentials are tombstoned
 * out of the ordinary sync/export path the moment a disconnect starts, each
 * provider target (QBO realm / Xero connection) is revoked provider-first, and
 * local credential deletion happens only after provider-confirmed completion —
 * or via an explicit operator force-finalize for permanent provider errors.
 */

export const PROVIDER_QBO = 'quickbooks_online';
export const PROVIDER_XERO = 'xero';

export const PROVIDER_TYPES = [PROVIDER_QBO, PROVIDER_XERO] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

/**
 * Synthetic target id for the Xero OAuth grant revocation step. Xero requires
 * per-connection deletes AND a single grant revocation once no connections
 * remain; modelling the grant as a target keeps retry uniform (the retry loop
 * only ever needs to revisit targets still pending).
 */
export const XERO_GRANT_TARGET_ID = '__xero_oauth_grant__';

export const DISCONNECT_RECORD_STATUSES = ['pending_revocation', 'failed_permanent', 'finalized'] as const;
export type DisconnectRecordStatus = (typeof DISCONNECT_RECORD_STATUSES)[number];

export const DISCONNECT_TARGET_STATUSES = ['pending_revocation', 'revoked', 'failed_permanent'] as const;
export type DisconnectTargetStatus = (typeof DISCONNECT_TARGET_STATUSES)[number];

export interface DisconnectTargetEntry {
  targetId: string;
  status: DisconnectTargetStatus;
  errorClass?: string | null;
  updatedAt: string;
}

export interface ProviderDisconnectRecord {
  tenant: string;
  provider: ProviderType;
  status: DisconnectRecordStatus;
  targets: DisconnectTargetEntry[];
  attemptCount: number;
  nextRetryAt: string | null;
  lastErrorClass: string | null;
  correlationId: string | null;
  startedAt: string;
  finalizedAt: string | null;
  finalizeReason: string | null;
  updatedAt: string;
}

/** Sanitized, user-visible summary of a pending/terminal disconnect. */
export interface ProviderDisconnectStatusInfo {
  status: Exclude<DisconnectRecordStatus, 'pending_revocation'> | 'pending_revocation';
  targets: Array<{
    targetId: string;
    status: DisconnectTargetStatus;
    errorClass?: string | null;
  }>;
  attemptCount: number;
  correlationId?: string | null;
  nextRetryAt?: string | null;
  finalizedAt?: string | null;
  finalizeReason?: string | null;
}

export const isProviderType = (value: string): value is ProviderType =>
  (PROVIDER_TYPES as readonly string[]).includes(value);
