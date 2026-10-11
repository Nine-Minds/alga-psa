import type { Knex } from 'knex';
import { tenantDb, tenantTableMetadata } from '@alga-psa/db';
import { CoManagedProvisioningError, type CoManagedProvisioningOperation } from '@alga-psa/co-managed';

/** Called only inside the provisioning cleanup admission transaction. The
 * existing tenant-deletion order remains the single dependency-order source;
 * the canonical relationship survives as the reservation's durable tombstone. */
export async function deleteCoManagedProvisioningRows(trx: Knex.Transaction, operation: CoManagedProvisioningOperation,
  deletionOrder: readonly string[]): Promise<void> {
  if (!trx.isTransaction) throw new CoManagedProvisioningError('OPERATION_CLOSED');
  const customer = tenantDb(trx, operation.customer_tenant);
  const columns = await trx('information_schema.columns as c')
    .join('information_schema.tables as t', function () { this.on('t.table_schema', 'c.table_schema').andOn('t.table_name', 'c.table_name'); })
    .where({ 'c.table_schema': 'public', 't.table_type': 'BASE TABLE' }).select('c.table_name', 'c.column_name', 'c.is_nullable');
  const tenantColumns = new Map<string, string>();
  for (const column of columns) if (column.column_name === 'tenant' || column.column_name === 'tenant_id' && !tenantColumns.has(column.table_name))
    tenantColumns.set(column.table_name, column.column_name);
  const order = [...new Set([...deletionOrder, 'tenants'])].filter(table => tenantColumns.has(table) && table !== 'co_management_relationships');
  const query = (table: string) => {
    const column = tenantColumns.get(table)!;
    const scope = tenantTableMetadata[table];
    if (scope?.scope === 'tenant') {
      if ((scope.tenantColumn ?? 'tenant') !== column) throw new CoManagedProvisioningError('CLEANUP_INCOMPLETE');
      return customer.table(table);
    }
    // Some registered reference tables contain explicitly tenant-owned rows.
    // Schema verification and the canonical cleanup allowlist bound this escape.
    return customer.unscoped(table, 'unactivated provisioning residual-data proof: schema-verified tenant column; deletion separately requires the canonical allowlist')
      .where(column, operation.customer_tenant);
  };
  // Bootstrap creates no blobs, mail subscriptions or installed extensions.
  // Preserve unexpected external-resource handles for explicit recovery instead
  // of acknowledging cleanup after only deleting their database metadata.
  for (const table of ['external_files', 'email_providers', 'tenant_extension_install'])
    if (tenantColumns.has(table) && await query(table).first()) throw new CoManagedProvisioningError('CLEANUP_INCOMPLETE');
  // Unknown or administrator-owned residual data is never silently abandoned.
  for (const [table] of tenantColumns) {
    if (table === 'co_management_relationships') continue;
    if (!order.includes(table) || tenantTableMetadata[table]?.scope === 'admin') {
      if (await query(table).first()) throw new CoManagedProvisioningError('CLEANUP_INCOMPLETE');
    }
  }
  // The ordinary deletion engine breaks these same nullable dependency cycles.
  // Verify installed columns first so an optional module cannot abort the transaction.
  for (const [table, column] of [['clients', 'account_manager_id'], ['contacts', 'client_id'], ['statuses', 'board_id'],
    ['authorization_bundles', 'published_revision_id'], ['inbound_ticket_defaults', 'client_id'], ['assets', 'stock_unit_id'], ['opportunities', 'suggestion_id']]) {
    if (columns.some(row => row.table_name === table && row.column_name === column && row.is_nullable === 'YES'))
      await query(table).whereNotNull(column).update({ [column]: null });
  }
  for (const table of order) {
    if (tenantTableMetadata[table]?.scope === 'admin') continue;
    await query(table).delete();
  }
  // Include explicitly tenant-keyed reference/legacy tables in the proof too.
  for (const [table] of tenantColumns) if (table !== 'co_management_relationships' && await query(table).first())
    throw new CoManagedProvisioningError('CLEANUP_INCOMPLETE');
}
