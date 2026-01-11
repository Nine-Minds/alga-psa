/**
 * Distribute email_processed_attachments on Citus (tenant distribution key).
 */
exports.config = { transaction: false };

exports.up = async function up(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping email_processed_attachments distribution');
    return;
  }

  const table = 'email_processed_attachments';
  const tableExists = await knex.schema.hasTable(table);
  if (!tableExists) {
    console.log(`${table} does not exist, skipping distribution`);
    return;
  }

  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = '${table}'::regclass
    ) as distributed
  `);

  if (isDistributed.rows[0].distributed) {
    console.log(`${table} already distributed`);
    return;
  }

  console.log(`Distributing ${table}...`);
  await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
  console.log(`✓ Distributed ${table}`);
};

exports.down = async function down(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  const table = 'email_processed_attachments';
  const tableExists = await knex.schema.hasTable(table);
  if (!tableExists) return;

  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = '${table}'::regclass
    ) as distributed
  `);
  if (!isDistributed.rows[0].distributed) return;

  console.log(`Undistributing ${table}...`);
  await knex.raw(`SELECT undistribute_table('${table}')`);
  console.log(`✓ Undistributed ${table}`);
};

