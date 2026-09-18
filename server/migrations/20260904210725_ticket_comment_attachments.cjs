exports.up = async function (knex) {
  await knex.schema.createTable('ticket_comment_attachments', table => {
    table.uuid('tenant').notNullable();
    table.uuid('attachment_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('ticket_id').notNullable();
    table.uuid('document_id').notNullable();
    table.uuid('created_by').notNullable();
    table.uuid('comment_id').nullable();
    table.string('state', 16).notNullable().defaultTo('draft');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.primary(['tenant', 'attachment_id']);
    table.unique(['tenant', 'document_id']);
    table.index(['tenant', 'ticket_id', 'comment_id']);
  });
  await knex.schema.createTable('ticket_comment_email_deliveries', table => {
    table.uuid('tenant').notNullable();
    table.uuid('comment_id').notNullable();
    table.text('recipient').notNullable();
    table.string('state', 16).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'comment_id', 'recipient']);
  });
  // Same distribution key as comments/documents. No cascading document deletion:
  // withdrawn rows remain as access tombstones even after a comment is deleted.
  const citus = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus'");
  if (citus.rows.length) {
    await knex.raw("SELECT create_distributed_table('ticket_comment_attachments', 'tenant')");
    await knex.raw("SELECT create_distributed_table('ticket_comment_email_deliveries', 'tenant')");
  }
  await knex.raw("ALTER TABLE ticket_comment_attachments ADD CHECK (state IN ('draft', 'attached', 'removed'))");
  await knex.raw("ALTER TABLE ticket_comment_attachments ADD CHECK ((state = 'draft' AND comment_id IS NULL) OR state = 'removed' OR (state = 'attached' AND comment_id IS NOT NULL))");
  await knex.raw("ALTER TABLE ticket_comment_email_deliveries ADD CHECK (state IN ('sending', 'sent', 'failed'))");
};
exports.down = async function (knex) {
  await knex.schema.dropTable('ticket_comment_email_deliveries');
  await knex.schema.dropTable('ticket_comment_attachments');
};
