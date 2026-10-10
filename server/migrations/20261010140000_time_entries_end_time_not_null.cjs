/**
 * Restore time_entries.end_time NOT NULL (stopwatch plan D8, phase 3).
 *
 * Open time entries (end_time IS NULL) were the old mobile timer. The phase-1 conversion migration
 * (20261010120100) turned them into stopwatch sessions and deleted the rows, and the legacy mobile
 * endpoints now run on sessions, so nothing writes NULL end_time any more.
 *
 * Safety: if any NULL end_time row exists this migration ABORTS with a clear error. It never deletes or
 * rewrites data; an operator must convert or remove the rows (rerun the conversion migration logic) first.
 *
 * Local table: plain ALTER TABLE ... SET NOT NULL.
 * Distributed (Citus) table: docs/AI_coding_standards.md "CitusDB 6" procedure - run the ALTER on every
 * shard with run_command_on_shards, then sync the coordinator catalog (pg_attribute.attnotnull), because a
 * coordinator-level ALTER can fail on distributed tables. The same procedure is used by
 * 20260521120000_enforce_time_entry_work_date_not_null.cjs.
 *
 * Idempotent: SET NOT NULL on an already NOT NULL column is a no-op and the catalog update is conditional.
 * transaction:false matches that precedent (shard DDL via run_command_on_shards, then a catalog update).
 */

exports.config = { transaction: false };

const TABLE = 'time_entries';
const COLUMN = 'end_time';

async function isCitusDistributedTable(knex, tableName) {
  // to_regclass guards against Citus not being installed (CE / plain Postgres): the catalog is then absent
  // and a direct reference to pg_dist_partition would raise.
  const citus = await knex.raw(`SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus`);
  if (citus.rows[0]?.has_citus !== true) return false;
  const result = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS is_distributed`,
    [tableName],
  );
  return result.rows[0]?.is_distributed === true;
}

async function isNotNull(knex) {
  const result = await knex.raw(
    `SELECT attnotnull FROM pg_attribute WHERE attrelid = ?::regclass AND attname = ? AND NOT attisdropped`,
    [TABLE, COLUMN],
  );
  return result.rows[0]?.attnotnull === true;
}

async function setNullability(knex, notNull) {
  const action = notNull ? 'SET NOT NULL' : 'DROP NOT NULL';
  if (await isCitusDistributedTable(knex, TABLE)) {
    await knex.raw(`SELECT * FROM run_command_on_shards(?, $$ALTER TABLE %s ALTER COLUMN ${COLUMN} ${action}$$)`, [TABLE]);
    await knex.raw(
      `UPDATE pg_attribute SET attnotnull = ? WHERE attrelid = ?::regclass AND attname = ? AND attnotnull = ?`,
      [notNull, TABLE, COLUMN, !notNull],
    );
    return;
  }
  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN ${COLUMN} ${action}`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(TABLE, COLUMN))) return;
  if (await isNotNull(knex)) {
    console.log('[time_entries_end_time_not_null] end_time already NOT NULL');
    return;
  }

  const nullCheck = await knex.raw(`SELECT COUNT(*)::integer AS count FROM ${TABLE} WHERE ${COLUMN} IS NULL`);
  const nullCount = Number(nullCheck.rows[0]?.count ?? 0);
  if (nullCount > 0) {
    throw new Error(
      `Cannot restore time_entries.end_time NOT NULL: ${nullCount} open time entr${nullCount === 1 ? 'y' : 'ies'} ` +
        `(end_time IS NULL) remain. Convert them to stopwatch sessions first ` +
        `(see migration 20261010120100_convert_open_time_entries_to_sessions); no data was changed.`,
    );
  }

  await setNullability(knex, true);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn(TABLE, COLUMN))) return;
  await setNullability(knex, false);
};
