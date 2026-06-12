/**
 * Migration: Add minimum_billable_time and round_up_to_nearest to contract_lines
 *
 * These fields were originally only in contract_line_presets and contract_line_service_hourly_configs.
 * Adding them to contract_lines to make them contract-line-level settings (same for all services).
 */

const isCitusEnabled = async (knex) => {
  const { rows } = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  return rows.length > 0;
};

const ensureDistributed = async (knex, tableName, distributionColumn) => {
  if (!(await isCitusEnabled(knex))) return;
  const { rows } = await knex.raw(
    'SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass LIMIT 1',
    [tableName]
  );
  if (rows.length > 0) return;
  await knex.raw('SELECT create_distributed_table(?, ?)', [tableName, distributionColumn]);
};

exports.up = async function(knex) {
  // The backfill below joins contract_lines (distributed since
  // 20251028090000 on fresh Citus chains) with the service config tables;
  // Citus cannot join distributed and local tables, so distribute them
  // first. No-op on plain Postgres and on clusters that already have them.
  await ensureDistributed(knex, 'contract_line_service_configuration', 'tenant');
  await ensureDistributed(knex, 'contract_line_service_hourly_configs', 'tenant');

  // Add columns to contract_lines table
  await knex.schema.table('contract_lines', (table) => {
    table.integer('minimum_billable_time').defaultTo(15);
    table.integer('round_up_to_nearest').defaultTo(15);
  });

  console.log('Added minimum_billable_time and round_up_to_nearest columns to contract_lines');

  // Backfill data for existing hourly contract lines from their first service config
  // CitusDB requires select-then-update pattern instead of column references in UPDATE
  const contractLinesToUpdate = await knex.raw(`
    SELECT
      cl.contract_line_id,
      cl.tenant,
      COALESCE(
        (
          SELECT hc.minimum_billable_time
          FROM contract_line_service_configuration clsc
          JOIN contract_line_service_hourly_configs hc ON clsc.config_id = hc.config_id AND clsc.tenant = hc.tenant
          WHERE clsc.contract_line_id = cl.contract_line_id
            AND clsc.tenant = cl.tenant
          LIMIT 1
        ),
        15
      ) as minimum_billable_time,
      COALESCE(
        (
          SELECT hc.round_up_to_nearest
          FROM contract_line_service_configuration clsc
          JOIN contract_line_service_hourly_configs hc ON clsc.config_id = hc.config_id AND clsc.tenant = hc.tenant
          WHERE clsc.contract_line_id = cl.contract_line_id
            AND clsc.tenant = cl.tenant
          LIMIT 1
        ),
        15
      ) as round_up_to_nearest
    FROM contract_lines cl
    WHERE cl.contract_line_type = 'Hourly'
      AND (cl.minimum_billable_time IS NULL OR cl.round_up_to_nearest IS NULL)
  `);

  // Update each contract line with parameterized values
  for (const record of contractLinesToUpdate.rows) {
    await knex('contract_lines')
      .where('contract_line_id', record.contract_line_id)
      .andWhere('tenant', record.tenant)
      .update({
        minimum_billable_time: record.minimum_billable_time,
        round_up_to_nearest: record.round_up_to_nearest
      });
  }

  console.log(`Backfilled ${contractLinesToUpdate.rows.length} hourly contract lines with values from service configs`);
};

exports.down = async function(knex) {
  // Remove columns from contract_lines table
  await knex.schema.table('contract_lines', (table) => {
    table.dropColumn('minimum_billable_time');
    table.dropColumn('round_up_to_nearest');
  });

  console.log('Removed minimum_billable_time and round_up_to_nearest columns from contract_lines');
};
