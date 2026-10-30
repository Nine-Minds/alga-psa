// CM L6c (3 of 3): partial index over pending co-managed sync intents,
// built CONCURRENTLY (hence its own non-transactional file). Idempotent.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('online_meetings'))) return;
  if (!(await knex.schema.hasColumn('online_meetings', 'co_managed_sync_operation_id'))) return;
  await knex.raw(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS online_meetings_co_managed_sync_pending ON online_meetings (tenant, co_managed_sync_requested_at, meeting_id) WHERE co_managed_sync_operation_id IS NOT NULL'
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS online_meetings_co_managed_sync_pending');
};
