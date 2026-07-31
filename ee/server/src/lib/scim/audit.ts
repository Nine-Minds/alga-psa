import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';

// LEVERAGE: friction audit-tenant-guc — the shared auditLog() helper silently
// drops rows whenever app.current_tenant is unset, so every caller that actually
// needs an audit trail has to set the GUC itself. The guard belongs one layer
// down, in the helper.

/**
 * Records an administrator action against a SCIM connection.
 *
 * SCIM credential operations are security-relevant, so this write must land
 * rather than be skipped: the shared auditLog() helper drops the row when the
 * app.current_tenant GUC is unset, which it is on ordinary request connections.
 */
export async function writeScimAudit(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  operation: string,
  recordId: string,
  details: Record<string, unknown>
): Promise<void> {
  // audit_logs carries a BEFORE INSERT trigger that reads app.current_tenant
  // with no fallback, so an unset GUC raises and aborts the whole enclosing
  // transaction. Set it transaction-locally (is_local = true) so the value can
  // never outlive this transaction on a pooled connection.
  await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);

  await tenantDb(trx, tenant).table('audit_logs').insert({
    tenant,
    audit_id: randomUUID(),
    user_id: userId,
    operation,
    table_name: 'scim_connections',
    record_id: recordId,
    changed_data: JSON.stringify({}),
    details: JSON.stringify(details),
    timestamp: trx.fn.now(),
  });
}
