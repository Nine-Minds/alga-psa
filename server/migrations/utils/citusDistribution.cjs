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
// Citus rejects CREATE/DROP TRIGGER on a distributed table unless
// citus.enable_unsafe_triggers is set, which this codebase does not set. A
// trigger on a tenant-distributed table is therefore defense-in-depth for plain
// Postgres and for tables Citus leaves local; where the table is distributed the
// invariant rests on the application path that writes it. Probe the extension
// first: pg_dist_partition does not exist on plain Postgres.
async function supportsTriggers(knex, tableName) {
  if (!(await canCreateDistributedTable(knex))) return true;
  return !(await isDistributed(knex, tableName));
}
module.exports = { canCreateDistributedTable, isDistributed, ensureTenantDistribution, supportsTriggers };
