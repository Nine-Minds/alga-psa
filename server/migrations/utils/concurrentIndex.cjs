'use strict';

// Resolve the index relative to its table, never independently through the
// search path: a later schema may contain a different index with the same name.
async function resolveIndex(knex, table, index) {
  const result = await knex.raw(`SELECT n.nspname AS schema, t.relname AS table_name,
    t.oid AS table_oid, i.indrelid, i.indisvalid
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_class idx ON idx.relnamespace = t.relnamespace AND idx.relname = ?
    LEFT JOIN pg_index i ON i.indexrelid = idx.oid
    WHERE t.oid = to_regclass(?)`, [index, table]);
  const row = result.rows[0];
  if (!row) throw new Error(`Cannot manage index ${index}: table ${table} does not exist`);
  if (row.indrelid != null && row.indrelid !== row.table_oid) {
    throw new Error(`Index ${row.schema}.${index} belongs to a different table than ${table}`);
  }
  return row;
}

async function ensureConcurrentIndex(knex, table, index, columns) {
  const current = await resolveIndex(knex, table, index);
  // Citus 12.1 can invalidate an existing coordinator index even with
  // IF NOT EXISTS. Keep valid indexes and rebuild interrupted concurrent DDL.
  if (current.indisvalid) return;
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS ??.??', [current.schema, index]);
  await knex.raw(`CREATE INDEX CONCURRENTLY ?? ON ??.?? (${columns.map(() => '??').join(', ')})`,
    [index, current.schema, current.table_name, ...columns]);
}

async function dropConcurrentIndex(knex, table, index) {
  const current = await resolveIndex(knex, table, index);
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS ??.??', [current.schema, index]);
}

module.exports = { ensureConcurrentIndex, dropConcurrentIndex };
