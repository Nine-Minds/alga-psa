/**
 * Migration to add client_contract_id column to invoice_items table
 * This allows us to properly track which contract generated each invoice item
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function(knex) {
  console.log('Adding client_contract_id column to invoice_items...');

  // Check if the column already exists
  const hasColumn = await knex.schema.hasColumn('invoice_items', 'client_contract_id');

  if (hasColumn) {
    console.log('  ✓ client_contract_id column already exists, skipping');
    return;
  }

  // Add the column
  await knex.schema.table('invoice_items', (table) => {
    table.uuid('client_contract_id');
  });

  console.log('  ✓ Added client_contract_id column to invoice_items');

  // Add index for performance
  await knex.raw('CREATE INDEX IF NOT EXISTS invoice_items_client_contract_id_index ON invoice_items(client_contract_id)');

  console.log('  ✓ Added index on client_contract_id');
  console.log('✓ Migration completed successfully');
};

exports.down = async function(knex) {
  console.log('Rolling back: Removing client_contract_id from invoice_items...');

  // Check if the column exists before trying to drop it
  const hasColumn = await knex.schema.hasColumn('invoice_items', 'client_contract_id');

  if (!hasColumn) {
    console.log('  ✓ client_contract_id column does not exist, nothing to rollback');
    return;
  }

  // Drop the index first
  await knex.raw('DROP INDEX IF EXISTS invoice_items_client_contract_id_index');

  // Drop the column
  await knex.schema.table('invoice_items', (table) => {
    table.dropColumn('client_contract_id');
  });

  console.log('✓ Rollback completed successfully');
};
