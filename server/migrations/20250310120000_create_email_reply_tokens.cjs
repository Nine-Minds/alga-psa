/**
 * Create email_reply_tokens table used for tracking outbound reply markers
 */

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('email_reply_tokens');
  if (exists) {
    return;
  }

  await knex.schema.createTable('email_reply_tokens', (table) => {
    table.uuid('tenant').notNullable();
    table.string('token').notNullable();
    table.uuid('ticket_id').nullable();
    table.uuid('project_id').nullable();
    table.uuid('comment_id').nullable();
    table.string('template').nullable();
    table.string('recipient_email').nullable();
    table.string('entity_type').notNullable().defaultTo('ticket');
    table.jsonb('metadata').nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).nullable();

    table.primary(['tenant', 'token']);
    table.unique(['token']);
    table.foreign('tenant').references('tenants.tenant');
    table
      .foreign(['tenant', 'ticket_id'])
      .references(['tenant', 'ticket_id'])
      .inTable('tickets');
    table
      .foreign(['tenant', 'project_id'])
      .references(['tenant', 'project_id'])
      .inTable('projects');
    table
      .foreign(['tenant', 'comment_id'])
      .references(['tenant', 'comment_id'])
      .inTable('comments');
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable('email_reply_tokens');
  if (!exists) {
    return;
  }

  await knex.schema.dropTable('email_reply_tokens');
};
