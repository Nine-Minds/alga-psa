/**
 * Index for the ticket.due_date date trigger, which scans tickets by (tenant, due_date) once per
 * published workflow per tick. Partial: tickets without a due date never match.
 *
 * NOTE: tickets is distributed in Citus, so the index is built outside a transaction. The shared
 * ensureConcurrentIndex helper has no partial-index support, so it applies the same
 * keep-a-valid-index / rebuild-an-interrupted-one rule here.
 */
exports.config = { transaction: false };

const INDEX = 'idx_tickets_tenant_due_date';

exports.up = async function up(knex) {
  const existing = await knex.raw(
    `SELECT i.indisvalid FROM pg_class idx
       JOIN pg_index i ON i.indexrelid = idx.oid
      WHERE idx.relname = ? AND i.indrelid = to_regclass('tickets')`,
    [INDEX]
  );
  if (existing.rows[0]?.indisvalid) return;
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX}`);
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX} ON tickets (tenant, due_date) WHERE due_date IS NOT NULL`);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX}`);
};
