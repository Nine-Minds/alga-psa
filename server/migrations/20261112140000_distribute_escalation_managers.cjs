'use strict';
const {
  distributeLocalTenantTables,
  hasCitus,
  inLockBoundedTransaction,
  isDistributed,
} = require('./utils/citusDistribution.cjs');

// escalation_managers was never distributed, so the SLA notification lookup
// that joins it to users is a recursively planned subplan shipped over a
// loopback connection — escalation recipients fail to resolve whenever the
// coordinator is near max_connections. Its keys already carry tenant;
// co-locate it with users.

const TABLE = 'escalation_managers';
const MANAGER_FK = 'escalation_managers_manager_fkey';

// 20260219000008 declares the manager FK ON DELETE SET NULL. Citus rejects
// that action on a key that includes the distribution column, so the table
// cannot be distributed with it. User deletion clears manager_user_id itself
// (userActions nullColumns), so the plain form loses nothing.
async function relaxManagerFk(knex) {
  const r = await knex.raw(
    'SELECT confdeltype FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [MANAGER_FK, TABLE],
  );
  if (r.rows?.[0]?.confdeltype !== 'n') return;
  await inLockBoundedTransaction(knex, async (trx) => {
    await trx.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${MANAGER_FK}`);
    // migration-lint: allow 2 - re-adds the constraint dropped one statement earlier with only its delete action removed, so every row already satisfies it; the table holds a handful of rows per board and NOT VALID would leave the shards with an unvalidated key
    await trx.raw(
      `ALTER TABLE ${TABLE} ADD CONSTRAINT ${MANAGER_FK} FOREIGN KEY (tenant, manager_user_id) REFERENCES users (tenant, user_id)`,
    );
  });
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (!(await hasCitus(knex))) return;
  if (!(await isDistributed(knex, 'users'))) return;

  if (!(await isDistributed(knex, TABLE))) await relaxManagerFk(knex);
  await distributeLocalTenantTables(knex, { tables: [TABLE], colocateWith: 'users' });
};

// Forward-only: undistribute_table() would have to cascade through users.
exports.down = async function down(_knex) {};

// create_distributed_table() must not run inside the migration batch transaction.
exports.config = { transaction: false };
