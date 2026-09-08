const columns = ['co_managed_sync_operation_id', 'co_managed_sync_action', 'co_managed_sync_requested_at', 'co_managed_sync_attempts', 'co_managed_sync_attempted_at', 'co_managed_sync_last_error'];
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn('online_meetings', columns[0])) await knex.schema.alterTable('online_meetings', table => {
    table.uuid('co_managed_sync_operation_id').nullable();
    table.text('co_managed_sync_action').nullable();
    table.timestamp('co_managed_sync_requested_at', { useTz: true }).nullable();
    table.integer('co_managed_sync_attempts').notNullable().defaultTo(0);
    table.timestamp('co_managed_sync_attempted_at', { useTz: true }).nullable();
    table.text('co_managed_sync_last_error').nullable();
  });
  if (!await knex('pg_constraint').where('conname', 'online_meetings_co_managed_sync_intent').whereRaw('conrelid = ?::regclass', ['online_meetings']).first()) {
    await knex.raw(`ALTER TABLE online_meetings ADD CONSTRAINT online_meetings_co_managed_sync_intent CHECK (
      co_managed_sync_attempts >= 0 AND (
        (co_managed_sync_operation_id IS NULL AND co_managed_sync_action IS NULL AND co_managed_sync_requested_at IS NULL) OR
        (co_managed_sync_operation_id IS NOT NULL AND co_managed_sync_action IN ('update', 'delete') AND co_managed_sync_action IS NOT NULL AND co_managed_sync_requested_at IS NOT NULL)
      ))`);
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS online_meetings_co_managed_sync_pending ON online_meetings (tenant, co_managed_sync_requested_at, meeting_id) WHERE co_managed_sync_operation_id IS NOT NULL');
};
exports.down = async function(knex) {
  if (!await knex.schema.hasColumn('online_meetings', columns[0])) return;
  if (await knex('online_meetings').whereNotNull(columns[0]).first('meeting_id')) throw new Error('Cannot discard pending co-managed meeting synchronization');
  await knex.raw('DROP INDEX IF EXISTS online_meetings_co_managed_sync_pending');
  await knex.raw('ALTER TABLE online_meetings DROP CONSTRAINT IF EXISTS online_meetings_co_managed_sync_intent');
  await knex.schema.alterTable('online_meetings', table => { for (const column of columns) table.dropColumn(column); });
};
