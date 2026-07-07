/**
 * Distribute ticket_materials and project_materials on Citus (tenant distribution key).
 * Companion to server/migrations/20260101093000_create_ticket_project_materials.cjs,
 * which created both tables without distributing them. project_materials is already
 * distributed in production (done out-of-band); the guard makes it a no-op there —
 * it is included so environments rebuilt from migrations get both tables distributed.
 *
 * No FK drop/recreate is needed: all FKs on both tables include the tenant column and
 * reference already-distributed colocation-group tables (tenants, tickets, projects,
 * clients, service_catalog), so create_distributed_table succeeds directly.
 */
exports.config = { transaction: false };

const TABLES = ['ticket_materials', 'project_materials'];

exports.up = async function up(knex) {
  const inRecovery = await knex.raw(`SELECT pg_is_in_recovery() as in_recovery`);
  if (inRecovery.rows[0].in_recovery) {
    console.log('Database is in recovery mode (read replica). Skipping Citus distribution.');
    console.log('This migration must run on the primary/coordinator node.');
    return;
  }

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping ticket_materials/project_materials distribution');
    return;
  }

  for (const table of TABLES) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`${table} does not exist, skipping distribution`);
      continue;
    }

    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${table}'::regclass
      ) as distributed
    `);
    if (isDistributed.rows[0].distributed) {
      console.log(`${table} already distributed`);
      continue;
    }

    console.log(`Distributing ${table}...`);
    await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
    console.log(`✓ Distributed ${table}`);
  }
};

exports.down = async function down(knex) {
  const inRecovery = await knex.raw(`SELECT pg_is_in_recovery() as in_recovery`);
  if (inRecovery.rows[0].in_recovery) {
    console.log('Database is in recovery mode (read replica). Skipping Citus undistribution.');
    return;
  }

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);
  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  for (const table of TABLES) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) continue;

    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${table}'::regclass
      ) as distributed
    `);
    if (!isDistributed.rows[0].distributed) continue;

    console.log(`Undistributing ${table}...`);
    await knex.raw(`SELECT undistribute_table('${table}')`);
    console.log(`✓ Undistributed ${table}`);
  }
};
