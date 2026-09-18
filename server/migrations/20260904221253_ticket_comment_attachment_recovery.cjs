exports.up = async function (knex) {
  await knex.schema.alterTable('comments', t => t.jsonb('comment_publication_payload'));
  await knex.schema.alterTable('ticket_comment_email_deliveries', t => {
    t.text('last_error');
    t.text('error_code');
    t.boolean('requires_reconciliation').notNullable().defaultTo(false);
    t.integer('attempts').notNullable().defaultTo(1);
  });
  await knex.schema.alterTable('ticket_comment_attachments', t => {
    t.jsonb('cleanup_file_ids');
    t.timestamp('cleanup_completed_at', { useTz: true });
  });
  await knex.schema.createTable('ticket_comment_attachment_challenges', t => {
    t.uuid('tenant').notNullable();
    t.text('token_hash').notNullable();
    t.text('browser_hash').notNullable();
    t.text('code_hash').notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('sent_at', { useTz: true }).notNullable();
    t.timestamp('consumed_at', { useTz: true });
    t.primary(['tenant', 'token_hash']);
  });
  const citus = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus'");
  if (citus.rows.length) await knex.raw("SELECT create_distributed_table('ticket_comment_attachment_challenges', 'tenant')");
};
exports.down = async function (knex) {
  await knex.schema.dropTable('ticket_comment_attachment_challenges');
  await knex.schema.alterTable('ticket_comment_attachments', t => t.dropColumns('cleanup_file_ids', 'cleanup_completed_at'));
  await knex.schema.alterTable('ticket_comment_email_deliveries', t => t.dropColumns('last_error', 'error_code', 'requires_reconciliation', 'attempts'));
  await knex.schema.alterTable('comments', t => t.dropColumn('comment_publication_payload'));
};
