'use strict';
// Distribute a tenant-scoped table on Citus, colocated with `tenants`.
// No-op on plain Postgres (CI CE path) and if already distributed.
async function canCreateDistributedTable(knex) {
  const r = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table') AS exists;`);
  return Boolean(r.rows?.[0]?.exists);
}
async function isDistributed(knex, tableName) {
  const r = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS is_distributed;`, [tableName]);
  return Boolean(r.rows?.[0]?.is_distributed);
}
async function ensureTenantDistribution(knex, tableName) {
  if (!(await canCreateDistributedTable(knex))) return;
  if (await isDistributed(knex, tableName)) return;
  await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'tenants')`);
}
module.exports = { canCreateDistributedTable, isDistributed, ensureTenantDistribution };
