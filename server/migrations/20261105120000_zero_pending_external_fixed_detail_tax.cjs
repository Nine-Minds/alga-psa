// alga-2026-0003122: an invoice whose tax is delegated to an external system
// (tax_source = 'pending_external') carries 0 tax on its invoice_charges rows,
// but before the application fix the fixed-plan allocation rows kept the billing
// engine's computed tax. Accounting export expansion requires detail tax to sum
// to the parent tax exactly, so every export batch for such an invoice failed
// with "Fixed-plan allocation totals do not match charge ...".
//
// Zero-only data repair: it sets tax_amount/tax_rate to 0 on
// invoice_charge_fixed_details rows belonging to a pending_external invoice and
// never writes a non-zero tax. Finalization is blocked while an invoice is
// pending_external (validateInvoiceFinalizationInternal), so this can only touch
// drafts. It is a safety net rather than a backfill — a database with no drifted
// rows (the expected case) updates nothing.
//
// No DDL, idempotent (a repaired row leaves the predicate, so a second run
// updates 0 rows), N-1 compatible, no volatile functions in the UPDATE.
//
// Runs outside one big transaction. Each tenant is repaired in batches of
// BATCH_SIZE detail rows, one short transaction per batch, looping until a batch
// comes back short. Every statement is tenant-pinned across the whole join chain
// (fixed details -> charge details -> charges -> invoices) so Citus routes it to
// that tenant's single shard.
const BATCH_SIZE = 1000;

exports.config = { transaction: false };
exports.BATCH_SIZE = BATCH_SIZE;

exports.up = async function up(knex) {
  const required = ['invoice_charge_fixed_details', 'invoice_charge_details', 'invoice_charges', 'invoices'];
  for (const table of required) {
    if (!(await knex.schema.hasTable(table))) return;
  }
  if (!(await knex.schema.hasColumn('invoices', 'tax_source'))) return;

  const tenants = await knex('invoices').where('tax_source', 'pending_external').distinct('tenant').pluck('tenant');

  for (const tenant of tenants) {
    for (;;) {
      const result = await knex.transaction(async (trx) => {
        await trx.raw("SET LOCAL lock_timeout = '2s'");
        return trx.raw(
          `
          WITH batch AS MATERIALIZED (
              SELECT ff.item_detail_id
                FROM invoice_charge_fixed_details AS ff
                JOIN invoice_charge_details AS dd
                  ON dd.tenant = ff.tenant
                 AND dd.item_detail_id = ff.item_detail_id
                JOIN invoice_charges AS cc
                  ON cc.tenant = dd.tenant
                 AND cc.item_id = dd.item_id
                JOIN invoices AS ii
                  ON ii.tenant = cc.tenant
                 AND ii.invoice_id = cc.invoice_id
               WHERE ff.tenant = ?
                 AND dd.tenant = ?
                 AND cc.tenant = ?
                 AND ii.tenant = ?
                 AND ii.tax_source = 'pending_external'
                 AND (COALESCE(ff.tax_amount, 0) <> 0 OR COALESCE(ff.tax_rate, 0) <> 0)
               LIMIT ?
          )
          UPDATE invoice_charge_fixed_details AS f
             SET tax_amount = 0,
                 tax_rate = 0
            FROM batch
           WHERE f.tenant = ?
             AND f.item_detail_id = batch.item_detail_id
          `,
          [tenant, tenant, tenant, tenant, BATCH_SIZE, tenant]
        );
      });
      const updated = typeof result.rowCount === 'number' ? result.rowCount : 0;
      if (updated < BATCH_SIZE) break;
    }
  }
};

exports.down = async function down() {
  // Data repair; nothing to restore (the engine tax it cleared was never owed on
  // an invoice whose tax is delegated to an external system).
};
