/**
 * Drop redundant client_contract_* tables.
 *
 * These tables were designed to allow per-client customizations of contract lines,
 * but contracts are already client-specific via client_contracts. The billing engine
 * reads from contract_lines directly, so these tables are not used.
 *
 * Tables being dropped (in dependency order):
 * - client_contract_service_rate_tiers
 * - client_contract_service_usage_config
 * - client_contract_service_hourly_configs
 * - client_contract_service_hourly_config
 * - client_contract_service_fixed_config
 * - client_contract_service_bucket_config
 * - client_contract_service_configuration
 * - client_contract_services
 * - client_contract_line_discounts
 * - client_contract_line_pricing
 * - client_contract_line_terms
 * - client_contract_lines
 *
 * NOTE: client_contracts is NOT dropped - it's the junction table linking contracts to clients.
 */

const TABLES_TO_DROP = [
  // Drop child tables first (deepest dependencies)
  'client_contract_service_rate_tiers',
  'client_contract_service_usage_config',
  'client_contract_service_hourly_configs',
  'client_contract_service_hourly_config',
  'client_contract_service_fixed_config',
  'client_contract_service_bucket_config',
  'client_contract_service_configuration',
  'client_contract_services',
  'client_contract_line_discounts',
  'client_contract_line_pricing',
  'client_contract_line_terms',
  // Drop parent table last
  'client_contract_lines',
];

async function dropTableIfExists(knex, tableName) {
  const exists = await knex.schema.hasTable(tableName);
  if (exists) {
    await knex.schema.dropTable(tableName);
    console.log(`  ✓ Dropped ${tableName}`);
    return true;
  }
  console.log(`  ⚠ Table ${tableName} does not exist, skipping`);
  return false;
}

exports.up = async function up(knex) {
  console.log('Dropping redundant client_contract_* tables...');
  console.log('(These tables are not used by the billing engine)');

  // First, drop any foreign key constraints that might reference these tables
  // The time_entries table has a FK to client_contract_lines that was removed in a previous migration
  // but we should check for any remaining constraints

  for (const tableName of TABLES_TO_DROP) {
    await dropTableIfExists(knex, tableName);
  }

  console.log('Done dropping redundant tables.');
};

exports.down = async function down(knex) {
  // This migration is not easily reversible as we would need to recreate all the
  // tables with their exact schema. For safety, we'll just log a warning.
  console.warn('⚠ This migration drops tables and cannot be automatically reversed.');
  console.warn('To restore these tables, you would need to re-run the original migrations:');
  console.warn('  - 20251008000001_rename_billing_to_contracts.cjs (client_contract_lines)');
  console.warn('  - 20251020090000_contract_templates_phase1.cjs (other tables)');
  throw new Error('Cannot automatically reverse table drops. Please restore from backup if needed.');
};
