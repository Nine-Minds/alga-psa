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

async function hasCitus(knex) {
  const r = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS has_citus;`);
  return Boolean(r.rows?.[0]?.has_citus);
}

async function hasConstraint(knex, tableName, constraintName) {
  const r = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass) AS present;`,
    [constraintName, tableName]
  );
  return Boolean(r.rows?.[0]?.present);
}

// Citus enforces a foreign key only when both rows can live on the same node:
// both tables tenant-distributed (hence colocated), or neither. Several
// tenant-scoped tables are still coordinator-local — `client_locations` above
// all — so a distributed referrer has to go without the constraint rather than
// fail the migration. This is the probe that 20250613190110,
// 20260415120[0-3]00, 20260518120000 and 20260816010000 each copied by hand;
// it lives here now (see the LEVERAGE note in 20260816010000).
async function isFkCompatible(knex, referencingTable, referencedTable) {
  try {
    if (!(await hasCitus(knex))) return true;
    const referencing = await isDistributed(knex, referencingTable);
    const referenced = await isDistributed(knex, referencedTable);
    return referencing === referenced;
  } catch {
    return true;
  }
}

// Adds a composite FK when the two tables' distribution states allow it, drops
// a leftover one when they do not, and is a no-op when it is already in place.
// Call it *after* distributing the referencing table: whether the FK is legal
// is only knowable once both sides have their final distribution state.
async function ensureCompositeFk(knex, spec) {
  const { table, constraint, columns, referencedTable, referencedColumns, onDelete } = spec;
  const present = await hasConstraint(knex, table, constraint);

  if (!(await isFkCompatible(knex, table, referencedTable))) {
    if (present) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
    }
    console.log(
      `${table} and ${referencedTable} have incompatible distribution - skipping foreign key ${constraint}`
    );
    return false;
  }

  if (!present) {
    await knex.raw(
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${columns.join(', ')}) ` +
        `REFERENCES ${referencedTable} (${referencedColumns.join(', ')})` +
        (onDelete ? ` ON DELETE ${onDelete}` : '')
    );
  }
  return true;
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

module.exports = {
  canCreateDistributedTable,
  isDistributed,
  ensureTenantDistribution,
  hasCitus,
  hasConstraint,
  isFkCompatible,
  ensureCompositeFk,
  supportsTriggers,
};
