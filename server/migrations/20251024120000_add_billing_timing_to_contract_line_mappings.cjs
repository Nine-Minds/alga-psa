/**
 * Migration: Add billing_timing column to contract_line_mappings
 *
 * This allows overriding the billing timing (arrears vs advance) on a per-contract basis
 */

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('contract_line_mappings', 'billing_timing');

  if (!hasColumn) {
    console.log('Adding billing_timing column to contract_line_mappings');
    await knex.schema.alterTable('contract_line_mappings', (table) => {
      table.string('billing_timing', 16).notNullable().defaultTo('arrears');
    });
    console.log('✓ Added billing_timing column to contract_line_mappings');
  } else {
    console.log('billing_timing column already exists in contract_line_mappings');
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('contract_line_mappings', 'billing_timing');

  if (hasColumn) {
    console.log('Removing billing_timing column from contract_line_mappings');
    await knex.schema.alterTable('contract_line_mappings', (table) => {
      table.dropColumn('billing_timing');
    });
    console.log('✓ Removed billing_timing column from contract_line_mappings');
  }
};
