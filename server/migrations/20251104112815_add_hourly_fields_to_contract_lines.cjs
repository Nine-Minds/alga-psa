/**
 * Migration: Add minimum_billable_time and round_up_to_nearest to contract_lines
 *
 * These fields were originally only in contract_line_presets and contract_line_service_hourly_configs.
 * Adding them to contract_lines to make them contract-line-level settings (same for all services).
 */

const MIGRATION_TENANT = 'migration:20251104112815_add_hourly_fields_to_contract_lines';
const CONTRACT_LINE_HOURLY_BACKFILL_REASON = 'discover hourly contract lines needing service-config defaults backfill';
const CITUS_METADATA_CHECK_REASON = 'Citus extension and distribution metadata checks for contract line hourly backfill';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

const isCitusEnabled = async (knex, migrationDb) => {
  const row = await migrationDb.unscoped('pg_extension', CITUS_METADATA_CHECK_REASON)
    .select(knex.raw('1'))
    .where('extname', 'citus')
    .first();
  return Boolean(row);
};

const ensureDistributed = async (knex, migrationDb, tableName, distributionColumn) => {
  if (!(await isCitusEnabled(knex, migrationDb))) return;
  const row = await migrationDb.unscoped('pg_dist_partition', CITUS_METADATA_CHECK_REASON)
    .select(knex.raw('1'))
    .whereRaw('logicalrelid = ?::regclass', [tableName])
    .first();
  if (row) return;
  await knex.raw('SELECT create_distributed_table(?, ?)', [tableName, distributionColumn]);
};

exports.up = async function(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);

  // The backfill below joins contract_lines (distributed since
  // 20251028090000 on fresh Citus chains) with the service config tables;
  // Citus cannot join distributed and local tables, so distribute them
  // first. No-op on plain Postgres and on clusters that already have them.
  await ensureDistributed(knex, migrationDb, 'contract_line_service_configuration', 'tenant');
  await ensureDistributed(knex, migrationDb, 'contract_line_service_hourly_configs', 'tenant');

  // Add columns to contract_lines table
  await knex.schema.table('contract_lines', (table) => {
    table.integer('minimum_billable_time').defaultTo(15);
    table.integer('round_up_to_nearest').defaultTo(15);
  });

  console.log('Added minimum_billable_time and round_up_to_nearest columns to contract_lines');

  // Backfill data for existing hourly contract lines from their first service config
  // CitusDB requires select-then-update pattern instead of column references in UPDATE
  const contractLinesToUpdate = await migrationDb.unscoped('contract_lines as cl', CONTRACT_LINE_HOURLY_BACKFILL_REASON)
    .select(
      'cl.contract_line_id',
      'cl.tenant',
      knex.raw(`COALESCE(
        (
          SELECT hc.minimum_billable_time
          FROM contract_line_service_configuration clsc
          JOIN contract_line_service_hourly_configs hc ON clsc.config_id = hc.config_id AND clsc.tenant = hc.tenant
          WHERE clsc.contract_line_id = cl.contract_line_id
            AND clsc.tenant = cl.tenant
          LIMIT 1
        ),
        15
      ) as minimum_billable_time`),
      knex.raw(`COALESCE(
        (
          SELECT hc.round_up_to_nearest
          FROM contract_line_service_configuration clsc
          JOIN contract_line_service_hourly_configs hc ON clsc.config_id = hc.config_id AND clsc.tenant = hc.tenant
          WHERE clsc.contract_line_id = cl.contract_line_id
            AND clsc.tenant = cl.tenant
          LIMIT 1
        ),
        15
      ) as round_up_to_nearest`)
    )
    .where('cl.contract_line_type', 'Hourly')
    .andWhere(function() {
      this.whereNull('cl.minimum_billable_time').orWhereNull('cl.round_up_to_nearest');
    });

  // Update each contract line with parameterized values
  for (const record of contractLinesToUpdate) {
    const db = tenantDb(knex, record.tenant);
    await db.table('contract_lines')
      .where('contract_line_id', record.contract_line_id)
      .update({
        minimum_billable_time: record.minimum_billable_time,
        round_up_to_nearest: record.round_up_to_nearest
      });
  }

  console.log(`Backfilled ${contractLinesToUpdate.length} hourly contract lines with values from service configs`);
};

exports.down = async function(knex) {
  // Remove columns from contract_lines table
  await knex.schema.table('contract_lines', (table) => {
    table.dropColumn('minimum_billable_time');
    table.dropColumn('round_up_to_nearest');
  });

  console.log('Removed minimum_billable_time and round_up_to_nearest columns from contract_lines');
};
