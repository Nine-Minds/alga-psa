exports.up = async function up(knex) {
  const hasState = await knex.schema.hasColumn('comments', 'publish_state');
  if (!hasState) {
    await knex.schema.alterTable('comments', (table) => {
      table.string('publish_state', 16).notNullable().defaultTo('published');
      table.timestamp('scheduled_publish_at', { useTz: true }).nullable();
      table.string('scheduled_publish_tz', 64).nullable();
      table.timestamp('published_at', { useTz: true }).nullable();
      table.uuid('schedule_job_id').nullable();
      // Stable event identity closes the transition -> event publish crash gap.
      // A retry republishes this same id, which is deduplicated by the event bus.
      table.uuid('scheduled_publish_event_id').nullable();
      table.timestamp('scheduled_publish_dispatched_at', { useTz: true }).nullable();
      table.uuid('scheduled_response_event_id').nullable();
      table.string('scheduled_previous_response_state', 32).nullable();
      table.timestamp('scheduled_response_dispatched_at', { useTz: true }).nullable();
    });
    await knex.raw("ALTER TABLE comments ADD CONSTRAINT comments_publish_state_check CHECK (publish_state IN ('published', 'scheduled', 'canceled'))");
    await knex.raw("CREATE INDEX comments_scheduled_publication_idx ON comments (tenant, scheduled_publish_at) WHERE publish_state = 'scheduled'");
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('comments', 'publish_state')) {
    await knex.raw('DROP INDEX IF EXISTS comments_scheduled_publication_idx');
    await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_publish_state_check');
    await knex.schema.alterTable('comments', (table) => {
      table.dropColumns('publish_state', 'scheduled_publish_at', 'scheduled_publish_tz', 'published_at', 'schedule_job_id', 'scheduled_publish_event_id', 'scheduled_publish_dispatched_at', 'scheduled_response_event_id', 'scheduled_previous_response_state', 'scheduled_response_dispatched_at');
    });
  }
};
