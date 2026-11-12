'use strict';
const { distributeLocalTenantTables, inLockBoundedTransaction } = require('./utils/citusDistribution.cjs');

// service_prices was created (20251205130000) with a price_id-only primary
// key, so it could never be distributed: Citus needs the distribution column
// in every unique key. It stayed coordinator-local, which makes every join to
// service_catalog a recursively planned subplan shipped over a loopback
// connection — the quote line-item picker shows "Failed to load results"
// whenever the coordinator is near max_connections. Key it by tenant and
// co-locate it with service_catalog.

const TABLE = 'service_prices';

async function tenantInPrimaryKey(knex) {
  const r = await knex.raw(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_constraint c
         JOIN unnest(c.conkey) AS k(attnum) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.conrelid = ?::regclass AND c.contype = 'p' AND a.attname = 'tenant'
     ) AS ok`,
    [TABLE],
  );
  return Boolean(r.rows?.[0]?.ok);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;

  if (!(await tenantInPrimaryKey(knex))) {
    // One transaction, so the table is never visible without a primary key.
    // Nothing references the old key, and the table holds a few rows per
    // catalog item, so the index rebuild is brief.
    await inLockBoundedTransaction(knex, async (trx) => {
      await trx.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${TABLE}_pkey`);
      await trx.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${TABLE}_pkey PRIMARY KEY (tenant, price_id)`);
    });
  }

  await distributeLocalTenantTables(knex, {
    tables: [TABLE],
    colocateWith: 'service_catalog',
    // 20260904130000 installs this trigger only where the table is local; once
    // distributed the per-tenant billing lock is the application's
    // (lockTenantBilling), as it already is for service_catalog — every
    // service_prices writer must take it explicitly.
    dropTriggers: { [TABLE]: ['billing_semantics_mutation'] },
  });
};

// Forward-only: undistribute_table() would have to cascade through
// service_catalog, and the tenant-leading key is the shape every install keeps.
exports.down = async function down(_knex) {};

// create_distributed_table() must not run inside the migration batch transaction.
exports.config = { transaction: false };
