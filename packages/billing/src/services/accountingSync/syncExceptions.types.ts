export type SyncExceptionType =
  | 'accounting_sync_drift'
  | 'accounting_sync_unmapped_payment'
  | 'accounting_sync_export_error'
  | 'accounting_sync_customer_unlinked'
  | 'accounting_connection_expired';

export interface SyncExceptionInput {
  type: SyncExceptionType;
  /** Alga-side entity kind the exception is about ('invoice', 'payment', 'client', 'connection', ...) */
  entityType: string;
  /** Stable identifier used for dedupe (one open exception per entity+type) */
  entityId: string;
  title: string;
  context: Record<string, unknown>;
}

export interface SyncExceptionService {
  /**
   * File an exception, deduplicated to one open task per entity+type:
   * an existing open task gets its context updated instead of a duplicate.
   * Returns whether a new task was created.
   */
  createOrUpdate(input: SyncExceptionInput): Promise<{ created: boolean }>;

  /** Close the open exception for an entity+type (resolution actions). */
  resolve(type: SyncExceptionType, entityType: string, entityId: string): Promise<void>;
}
