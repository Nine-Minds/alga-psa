exports.up = async function(knex) {
  await knex.schema.alterTable('comments', table => {
    table.timestamp('scheduled_publish_retry_at', { useTz: true }).nullable();
  });
  await knex.raw("CREATE INDEX comments_scheduled_recovery_idx ON comments (tenant, scheduled_publish_retry_at, scheduled_publish_at) WHERE publish_state = 'scheduled' OR (scheduled_publish_event_id IS NOT NULL AND scheduled_publish_dispatched_at IS NULL)");
};
exports.down = async function(knex) {
  if (await knex('comments').whereNotNull('scheduled_publish_retry_at').first('comment_id')) throw new Error('Cannot remove scheduled recovery while retained retries exist');
  await knex.schema.alterTable('comments', table => table.dropColumn('scheduled_publish_retry_at'));
};
