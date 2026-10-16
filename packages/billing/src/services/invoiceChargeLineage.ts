import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Read line ownership without inventing recurring coverage for true-ups. */
export async function loadInvoiceChargeLineIds(
  conn: Knex | Knex.Transaction,
  tenant: string,
  invoiceId: string,
): Promise<Map<string, Set<string>>> {
  const db = tenantDb(conn, tenant);
  const query = db.table('invoice_charges as charge');
  db.tenantJoin(query, 'invoice_charge_details as detail', 'detail.item_id', 'charge.item_id');
  db.tenantJoin(query, 'contract_line_service_configuration as config', 'config.config_id', 'detail.config_id');
  const details = await query.where('charge.invoice_id', invoiceId)
    .select('charge.item_id', 'config.contract_line_id');
  const result = new Map<string, Set<string>>();
  const add = (rows: Array<{ item_id: string; contract_line_id: string }>) => {
    for (const row of rows) {
      const ids = result.get(row.item_id) ?? new Set<string>();
      ids.add(row.contract_line_id);
      result.set(row.item_id, ids);
    }
  };
  add(details);

  // The companion may deploy separately. Its settlements intentionally have
  // no canonical detail rows: revision identity resolves their owning line.
  const companion = await db.table('invoice_charges')
    .where({ invoice_id: invoiceId, adjustment_source_kind: 'contract_change' })
    .first('item_id');
  if (companion && await conn.schema.hasTable('contract_recurring_unit_adjustments')) {
    const ledger = db.table('invoice_charges as charge');
    // Explicit tenant join keeps this consumer compatible before the companion
    // table's metadata registration is merged into this branch.
    ledger.join('contract_recurring_unit_adjustments as source', function () {
      // This branch permits text source IDs; the companion revision is UUID.
      this.on(conn.raw('??::text = ??::text', ['source.revision_id', 'charge.adjustment_source_id']))
        .andOn('source.tenant', '=', 'charge.tenant');
    });
    add(await ledger.where({ 'charge.invoice_id': invoiceId, 'charge.adjustment_source_kind': 'contract_change' })
      .select('charge.item_id', 'source.contract_line_id'));
  }
  return result;
}
