'use strict';
const { hasCitus, isDistributed } = require('./utils/citusDistribution.cjs');

// service_prices was created (20251205130000) with a price_id-only primary
// key, so it could never be distributed: Citus needs the distribution column
// in every unique key. It stayed coordinator-local, which makes every join to
// service_catalog a recursively planned subplan shipped over a loopback
// connection — the quote line-item picker shows "Failed to load results"
// whenever the coordinator is near max_connections. Key it by tenant and
// co-locate it with service_catalog.
//
// LEVERAGE: pattern distribute-local-table — second copy of
// 20261022200000_distribute_invoice_payments (tenant into the PK, distribute
// colocated with the parent, guarded local-heap truncate). More local tenant
// tables need the same treatment; utils/citusDistribution.cjs should own it.

const TABLE = 'service_prices';
const PARENT = 'service_catalog';
const LOCK_TRIGGER = 'billing_semantics_mutation';
const LOCK_ATTEMPTS = 3;

// Both steps take ACCESS EXCLUSIVE on a table the billing read paths hit
// constantly. Give up after 2s rather than queue every reader behind a long
// transaction, and retry a few times before failing the migration.
// LEVERAGE: pattern migration-lock-retry — third site after 20261029140400 and
// 20261106090000 (those retry on a savepoint; this one owns its transaction).
async function inLockBoundedTransaction(knex, work) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await knex.transaction(async (trx) => {
        await trx.raw("SET LOCAL lock_timeout = '2s'");
        return work(trx);
      });
    } catch (error) {
      if (error.code !== '55P03' || attempt >= LOCK_ATTEMPTS) throw error;
    }
  }
}

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

// Tables that FK to service_prices and are still local would lose all their
// rows to the cascading TRUNCATE below (see 20260513100800's header).
async function localReferrers(knex) {
  const r = await knex.raw(
    `SELECT DISTINCT con.conrelid::regclass::text AS tbl
       FROM pg_constraint con
      WHERE con.contype = 'f'
        AND con.confrelid = ?::regclass
        AND con.conrelid <> con.confrelid
        AND NOT EXISTS (SELECT 1 FROM pg_dist_partition p WHERE p.logicalrelid = con.conrelid)`,
    [TABLE],
  );
  return (r.rows ?? []).map((row) => row.tbl);
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

  if (!(await hasCitus(knex))) return;
  if (!(await isDistributed(knex, PARENT))) return;

  if (!(await isDistributed(knex, TABLE))) {
    await inLockBoundedTransaction(knex, async (trx) => {
      // Citus refuses to distribute a table that has triggers. 20260904130000
      // installs this one only where the table is local; once distributed the
      // per-tenant billing lock is the application's (lockTenantBilling), as
      // it already is for service_catalog — every service_prices writer must
      // take it explicitly. Dropped in the same transaction as the
      // distribution so a failed attempt leaves the trigger in place.
      await trx.raw(`DROP TRIGGER IF EXISTS ${LOCK_TRIGGER} ON ${TABLE}`);
      // The service_catalog colocation group reaches reference tables through
      // FKs, so Citus refuses the default parallel DDL (SET LOCAL resets on
      // commit).
      await trx.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
      await trx.raw(
        `SELECT create_distributed_table(?, 'tenant', colocate_with => '${PARENT}')`,
        [TABLE],
      );
    });
  }

  // Rows that existed before distribution stay in the coordinator parent heap,
  // invisible to routed queries but in the way of later DDL. Nothing FKs to
  // service_prices today; if something local ever does, leave the heap alone
  // rather than cascade into it.
  const heap = await knex.raw('SELECT pg_relation_size(?::regclass) AS bytes', [TABLE]);
  if (Number(heap.rows?.[0]?.bytes ?? 0) === 0) return;
  const blockers = await localReferrers(knex);
  if (blockers.length > 0) {
    console.log(`${TABLE}: skipping local-heap truncate; local referrers: ${blockers.join(', ')}`);
    return;
  }
  await knex.raw('SELECT truncate_local_data_after_distributing_table(?::regclass)', [TABLE]);
};

// Forward-only: undistribute_table() would have to cascade through
// service_catalog, and the tenant-leading key is the shape every install keeps.
exports.down = async function down(_knex) {};

// create_distributed_table() must not run inside the migration batch transaction.
exports.config = { transaction: false };
