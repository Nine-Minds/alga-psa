/**
 * Rename accounting export line document references so vendor bills no longer
 * masquerade as invoices in the shared export engine.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasLines = await knex.schema.hasTable('accounting_export_lines');
  if (!hasLines) {
    return;
  }

  const hasInvoiceId = await knex.schema.hasColumn('accounting_export_lines', 'invoice_id');
  if (hasInvoiceId) {
    await knex.schema.alterTable('accounting_export_lines', (table) => {
      table.renameColumn('invoice_id', 'document_id');
    });
  }

  const hasInvoiceChargeId = await knex.schema.hasColumn('accounting_export_lines', 'invoice_charge_id');
  if (hasInvoiceChargeId) {
    await knex.schema.alterTable('accounting_export_lines', (table) => {
      table.renameColumn('invoice_charge_id', 'document_line_id');
    });
  }

  await renameIndexIfExists(knex, 'accounting_export_lines_tenant_invoice_idx', 'accounting_export_lines_tenant_document_idx');
  await renameIndexIfExists(
    knex,
    'accounting_export_lines_tenant_invoice_charge_idx',
    'accounting_export_lines_tenant_document_line_idx'
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasLines = await knex.schema.hasTable('accounting_export_lines');
  if (!hasLines) {
    return;
  }

  await renameIndexIfExists(knex, 'accounting_export_lines_tenant_document_idx', 'accounting_export_lines_tenant_invoice_idx');
  await renameIndexIfExists(
    knex,
    'accounting_export_lines_tenant_document_line_idx',
    'accounting_export_lines_tenant_invoice_charge_idx'
  );

  const hasDocumentId = await knex.schema.hasColumn('accounting_export_lines', 'document_id');
  if (hasDocumentId) {
    await knex.schema.alterTable('accounting_export_lines', (table) => {
      table.renameColumn('document_id', 'invoice_id');
    });
  }

  const hasDocumentLineId = await knex.schema.hasColumn('accounting_export_lines', 'document_line_id');
  if (hasDocumentLineId) {
    await knex.schema.alterTable('accounting_export_lines', (table) => {
      table.renameColumn('document_line_id', 'invoice_charge_id');
    });
  }
};

async function renameIndexIfExists(knex, fromName, toName) {
  await knex.raw(
    `
    DO $rename_index$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relkind = 'i'
          AND relname = ?
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relkind = 'i'
          AND relname = ?
      ) THEN
        EXECUTE format('ALTER INDEX %I RENAME TO %I', ?, ?);
      END IF;
    END;
    $rename_index$;
    `,
    [fromName, toName, fromName, toName]
  );
}
