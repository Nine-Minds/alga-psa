/**
 * Create first-class comment threads for ticket and project-task comments.
 *
 * The table is tenant-scoped and polymorphic: exactly one of ticket_id or
 * project_task_id must be present. Comment-table FKs are added in follow-up
 * migrations to avoid circular migration ordering during backfill.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('comment_threads');
  if (exists) {
    return;
  }

  await knex.schema.createTable('comment_threads', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('thread_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('ticket_id').nullable();
    table.uuid('project_task_id').nullable();
    table.uuid('root_comment_id').notNullable();
    table.boolean('is_internal').notNullable().defaultTo(false);
    table.integer('reply_count').notNullable().defaultTo(0);
    table.timestamp('last_activity_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('email_message_id').nullable();
    table.specificType('email_references', 'text[]').notNullable().defaultTo(knex.raw("'{}'::text[]"));
    table.text('email_provider_thread_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.uuid('created_by').nullable();

    table.primary(['tenant', 'thread_id']);
    table.foreign('tenant').references('tenants.tenant');
    table
      .foreign(['tenant', 'ticket_id'], 'comment_threads_ticket_fk')
      .references(['tenant', 'ticket_id'])
      .inTable('tickets')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'project_task_id'], 'comment_threads_project_task_fk')
      .references(['tenant', 'task_id'])
      .inTable('project_tasks')
      .onDelete('CASCADE');
    table.check(
      '((?? IS NOT NULL)::int + (?? IS NOT NULL)::int = 1)',
      ['ticket_id', 'project_task_id'],
      'comment_threads_exactly_one_parent_check'
    );
  });
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('comment_threads');
};
