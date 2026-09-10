/**
 * Accounting integration audit writer.
 *
 * Every accounting-integration lifecycle/config/mutation operation that a user
 * triggers writes an audit row so the history of who changed integration
 * state — credentials, connections, default-company selection, mappings, export
 * execution, remote voids — is durable and reviewable. It mirrors the
 * credentials vault writer (ee/server/src/lib/credentials/audit.ts): the row is
 * written inside a transaction with the `app.current_tenant` GUC set (the
 * auditLog helper skips inserts when the GUC is unset).
 *
 * Audit `details` never contain secret material: credential operations record
 * only that a value was replaced, never the value itself; token/refresh-token
 * material is never logged.
 */

import type { Knex } from 'knex';
import { auditLog } from './auditLog';

export type AccountingAuditOperation =
  | 'accounting_credentials_saved'
  | 'accounting_connected'
  | 'accounting_disconnected'
  | 'accounting_default_realm_changed'
  | 'accounting_mapping_created'
  | 'accounting_mapping_updated'
  | 'accounting_mapping_deleted'
  | 'accounting_export_executed'
  | 'accounting_sync_cycle_run'
  | 'accounting_remote_void';

export type AccountingAuditProvider = 'qbo' | 'xero' | 'quickbooks_online' | 'csv';

export interface AccountingAuditParams {
  userId?: string;
  provider: AccountingAuditProvider;
  /** Optional provider-side identifier (realm id, connection id, mapping id). */
  recordId?: string;
  details?: Record<string, unknown>;
}

export async function writeAccountingAudit(
  knex: Knex | Knex.Transaction,
  tenant: string,
  operation: AccountingAuditOperation,
  params: AccountingAuditParams,
): Promise<void> {
  await knex.transaction(async (trx) => {
    await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
    await auditLog(trx, {
      userId: params.userId,
      operation,
      tableName: 'accounting_integrations',
      recordId: params.recordId ?? params.provider,
      changedData: {},
      details: {
        integration: params.provider,
        tenant,
        ...params.details,
      },
    });
  });
}
