exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('comment_attachment_drafts'))) {
    await knex.schema.createTable('comment_attachment_drafts', table => {
      table.uuid('tenant').notNullable();
      table.uuid('draft_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('entity_type', 32).notNullable();
      table.uuid('entity_id').notNullable();
      table.uuid('document_id').notNullable();
      table.uuid('file_id').nullable();
      table.uuid('created_by').notNullable();
      table.uuid('comment_id').nullable();
      table.string('state', 16).notNullable().defaultTo('draft');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.jsonb('cleanup_file_ids').nullable();
      table.timestamp('cleanup_completed_at', { useTz: true }).nullable();
      table.check("entity_type IN ('ticket', 'project_task')", [], 'comment_attachment_drafts_entity_type_check');
      table.check("state IN ('draft', 'attached', 'removed')", [], 'comment_attachment_drafts_state_check');
      table.check(
        "(state = 'draft' AND comment_id IS NULL) OR state = 'removed' OR (state = 'attached' AND comment_id IS NOT NULL)",
        [], 'comment_attachment_drafts_lifecycle_check'
      );
      table.primary(['tenant', 'draft_id']);
      table.unique(['tenant', 'document_id']);
      table.index(['tenant', 'entity_type', 'entity_id', 'comment_id']);
      table.index(['tenant', 'file_id'], 'comment_attachment_drafts_file_idx');
    });
  }
  await knex.raw(`
    INSERT INTO comment_attachment_drafts (tenant, entity_type, entity_id, document_id, file_id, created_by, comment_id, state, created_at, expires_at)
    SELECT ca.tenant, 'ticket', ca.ticket_id, ca.document_id, d.file_id, ca.created_by, ca.comment_id, ca.state, ca.created_at, ca.expires_at
    FROM ticket_comment_attachments ca LEFT JOIN documents d ON d.tenant = ca.tenant AND d.document_id = ca.document_id
    ON CONFLICT (tenant, document_id) DO NOTHING
  `);
  const citus = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus'");
  if (citus.rows.length) {
    const distributed = await knex.raw("SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'comment_attachment_drafts'::regclass");
    if (!distributed.rows.length) await knex.raw("SELECT create_distributed_table('comment_attachment_drafts', 'tenant')");
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('comment_attachment_drafts');
};
