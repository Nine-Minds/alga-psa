'use strict';
const { hasCitus, isDistributed } = require('./utils/citusDistribution.cjs');

// invoice_payments landed on EE installs from
// ee/server/migrations/20251203120000 with a payment_id-only primary key, so
// 20260722120000 left it alone: Citus needs the distribution column in every
// unique key. The table stayed coordinator-local, which makes every join to
// invoices a recursively planned subplan shipped over a loopback connection —
// the client pulse money section fails whenever the coordinator is near
// max_connections. Give it the CE key shape and co-locate it with invoices.

const TABLE = 'invoice_payments';

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

// Tables that FK to invoice_payments and are still local would lose all their
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
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${TABLE}_pkey`);
    await knex.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${TABLE}_pkey PRIMARY KEY (tenant, payment_id)`);
  }

  if (!(await hasCitus(knex))) return;
  if (!(await isDistributed(knex, 'invoices'))) return;

  if (!(await isDistributed(knex, TABLE))) {
    // The invoices colocation group reaches reference tables through FKs, so
    // Citus refuses the default parallel DDL; run it sequentially in its own
    // transaction (SET LOCAL resets on commit).
    await knex.transaction(async (trx) => {
      await trx.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
      await trx.raw(
        "SELECT create_distributed_table(?, 'tenant', colocate_with => 'invoices')",
        [TABLE],
      );
    });
  }

  // Rows that existed before distribution stay in the coordinator parent heap,
  // invisible to routed queries but in the way of later DDL. Nothing FKs to
  // invoice_payments today; if something local ever does, leave the heap alone
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

// Forward-only: undistribute_table() would have to cascade through invoices.
exports.down = async function down(_knex) {};

// create_distributed_table() must run outside a transaction block.
exports.config = { transaction: false };
