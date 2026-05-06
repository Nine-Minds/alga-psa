exports.config = { transaction: false };

async function isCitusEnabled(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) AS enabled
  `);

  return Boolean(result.rows?.[0]?.enabled);
}

async function distributeTable(knex, tableName) {
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log(`${tableName} table missing, skipping distribution`);
    return;
  }

  const alreadyDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_dist_partition
      WHERE logicalrelid = '${tableName}'::regclass
    ) AS distributed
  `);

  if (alreadyDistributed.rows?.[0]?.distributed) {
    console.log(`${tableName} already distributed`);
    return;
  }

  await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'tenants')`);
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await isCitusEnabled(knex))) {
    console.log('Citus not enabled, skipping webhook table distribution');
    return;
  }

  await distributeTable(knex, 'webhooks');
  await distributeTable(knex, 'webhook_deliveries');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (!(await isCitusEnabled(knex))) {
    return;
  }

  if (await knex.schema.hasTable('webhook_deliveries')) {
    await knex.raw(`SELECT undistribute_table('webhook_deliveries')`);
  }

  if (await knex.schema.hasTable('webhooks')) {
    await knex.raw(`SELECT undistribute_table('webhooks')`);
  }
};
