/**
 * Migration: Add minimum_billable_time and round_up_to_nearest to contract_lines
 *
 * These fields were originally only in contract_line_presets and contract_line_service_hourly_configs.
 * Adding them to contract_lines to make them contract-line-level settings (same for all services).
 */

exports.up = async function(knex) {
  // Add columns to contract_lines table
  await knex.schema.table('contract_lines', (table) => {
    table.integer('minimum_billable_time').defaultTo(15);
    table.integer('round_up_to_nearest').defaultTo(15);
  });

  console.log('Added minimum_billable_time and round_up_to_nearest columns to contract_lines');

  // Backfill data for existing hourly contract lines from their first service config
  const result = await knex.raw(`
    UPDATE contract_lines cl
    SET
      minimum_billable_time = COALESCE(
        (
          SELECT hc.minimum_billable_time
          FROM contract_line_service_configuration clsc
          JOIN contract_line_service_hourly_configs hc ON clsc.config_id = hc.config_id
          WHERE clsc.contract_line_id = cl.contract_line_id
            AND clsc.tenant = cl.tenant
          LIMIT 1
        ),
        15
      ),
      round_up_to_nearest = COALESCE(
        (
          SELECT hc.round_up_to_nearest
          FROM contract_line_service_configuration clsc
          JOIN contract_line_service_hourly_configs hc ON clsc.config_id = hc.config_id
          WHERE clsc.contract_line_id = cl.contract_line_id
            AND clsc.tenant = cl.tenant
          LIMIT 1
        ),
        15
      )
    WHERE cl.contract_line_type = 'Hourly'
      AND (cl.minimum_billable_time IS NULL OR cl.round_up_to_nearest IS NULL);
  `);

  console.log('Backfilled hourly contract lines with values from service configs');
};

exports.down = async function(knex) {
  // Remove columns from contract_lines table
  await knex.schema.table('contract_lines', (table) => {
    table.dropColumn('minimum_billable_time');
    table.dropColumn('round_up_to_nearest');
  });

  console.log('Removed minimum_billable_time and round_up_to_nearest columns from contract_lines');
};
