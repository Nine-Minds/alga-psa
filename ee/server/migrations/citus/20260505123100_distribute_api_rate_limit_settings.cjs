exports.config = { transaction: false };

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (!citusEnabled.rows?.[0]?.enabled) {
    console.log('Citus not enabled, skipping api_rate_limit_settings distribution');
    return;
  }

  const tableExists = await knex.schema.hasTable('api_rate_limit_settings');
  if (!tableExists) {
    console.log('api_rate_limit_settings table missing, skipping distribution');
    return;
  }

  const alreadyDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_dist_partition
      WHERE logicalrelid = 'api_rate_limit_settings'::regclass
    ) AS distributed
  `);

  if (alreadyDistributed.rows?.[0]?.distributed) {
    console.log('api_rate_limit_settings already distributed');
    return;
  }

  await knex.raw(`SELECT create_distributed_table('api_rate_limit_settings', 'tenant', colocate_with => 'tenants')`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (!citusEnabled.rows?.[0]?.enabled) {
    return;
  }

  const tableExists = await knex.schema.hasTable('api_rate_limit_settings');
  if (!tableExists) {
    return;
  }

  await knex.raw(`SELECT undistribute_table('api_rate_limit_settings')`);
};
