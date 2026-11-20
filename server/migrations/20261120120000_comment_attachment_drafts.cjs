exports.up = async function (knex) {
  await knex.schema.createTable('comment_attachment_drafts', table => {
    table.uuid('tenant').notNullable();
    table.uuid('draft_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('entity_type', 32).notNullable();
    table.uuid('entity_id').notNullable();
    table.uuid('document_id').notNullable();
    table.uuid('created_by').notNullable();
    table.uuid('comment_id').nullable();
    table.string('state', 16).notNullable().defaultTo('draft');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.primary(['tenant', 'draft_id']);
    table.unique(['tenant', 'document_id']);
    table.index(['tenant', 'entity_type', 'entity_id', 'comment_id']);
  });
  await knex.raw("ALTER TABLE comment_attachment_drafts ADD CHECK (entity_type IN ('ticket', 'project_task'))");
  await knex.raw("ALTER TABLE comment_attachment_drafts ADD CHECK (state IN ('draft', 'attached', 'removed'))");
  await knex.raw("ALTER TABLE comment_attachment_drafts ADD CHECK ((state = 'draft' AND comment_id IS NULL) OR state = 'removed' OR (state = 'attached' AND comment_id IS NOT NULL))");
  await knex.raw(`
    INSERT INTO comment_attachment_drafts (tenant, entity_type, entity_id, document_id, created_by, comment_id, state, created_at, expires_at)
    SELECT tenant, 'ticket', ticket_id, document_id, created_by, comment_id, state, created_at, expires_at
    FROM ticket_comment_attachments
    ON CONFLICT (tenant, document_id) DO NOTHING
  `);
  const citus = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus'");
  if (citus.rows.length) await knex.raw("SELECT create_distributed_table('comment_attachment_drafts', 'tenant')");
};

exports.down = async function (knex) {
  await knex.schema.dropTable('comment_attachment_drafts');
};
