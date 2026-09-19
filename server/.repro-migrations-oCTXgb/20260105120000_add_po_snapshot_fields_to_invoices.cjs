/**
 * Add invoice-level purchase order snapshot fields.
 *
 * - invoices.po_number (text, nullable)
 * - invoices.client_contract_id (uuid, nullable)
 *
 * These are populated when generating invoices from contract billing to:
 * - show PO number on invoices/PDF
 * - support PO authorized spend tracking per client contract assignment
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  const hasPoNumber = await knex.schema.hasColumn('invoices', 'po_number');
  const hasClientContractId = await knex.schema.hasColumn('invoices', 'client_contract_id');

  if (!hasPoNumber || !hasClientContractId) {
    await knex.schema.alterTable('invoices', (table) => {
      if (!hasPoNumber) {
        table.text('po_number').nullable();
      }
      if (!hasClientContractId) {
        table.uuid('client_contract_id').nullable();
      }
    });
  }

  if (!hasClientContractId) {
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS invoices_client_contract_id_index ON invoices (client_contract_id)'
    );
  }

  if (!hasPoNumber) {
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS invoices_po_number_index ON invoices (po_number) WHERE po_number IS NOT NULL'
    );
  }
};

exports.down = async function down(knex) {
  const hasPoNumber = await knex.schema.hasColumn('invoices', 'po_number');
  const hasClientContractId = await knex.schema.hasColumn('invoices', 'client_contract_id');

  if (hasClientContractId) {
    await knex.raw('DROP INDEX IF EXISTS invoices_client_contract_id_index');
  }

  if (hasPoNumber) {
    await knex.raw('DROP INDEX IF EXISTS invoices_po_number_index');
  }

  if (hasPoNumber || hasClientContractId) {
    await knex.schema.alterTable('invoices', (table) => {
      if (hasPoNumber) {
        table.dropColumn('po_number');
      }
      if (hasClientContractId) {
        table.dropColumn('client_contract_id');
      }
    });
  }
};

