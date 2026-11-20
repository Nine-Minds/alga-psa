exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('comment_attachment_drafts', 'file_id'))) {
    await knex.schema.alterTable('comment_attachment_drafts', table => {
      table.uuid('file_id').nullable();
      table.index(['tenant', 'file_id'], 'comment_attachment_drafts_file_idx');
    });
  }
  if (!(await knex.schema.hasColumn('comment_attachment_drafts', 'cleanup_file_ids'))) {
    await knex.schema.alterTable('comment_attachment_drafts', table => table.jsonb('cleanup_file_ids').nullable());
  }
  if (!(await knex.schema.hasColumn('comment_attachment_drafts', 'cleanup_completed_at'))) {
    await knex.schema.alterTable('comment_attachment_drafts', table => table.timestamp('cleanup_completed_at', { useTz: true }).nullable());
  }
  await knex.raw(`UPDATE comment_attachment_drafts cad SET file_id = d.file_id
    FROM documents d WHERE cad.tenant = d.tenant AND cad.document_id = d.document_id AND cad.file_id IS NULL`);
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('comment_attachment_drafts', 'file_id')) {
    await knex.schema.alterTable('comment_attachment_drafts', table => {
      table.dropIndex(['tenant', 'file_id'], 'comment_attachment_drafts_file_idx');
      table.dropColumn('file_id');
    });
  }
  if (await knex.schema.hasColumn('comment_attachment_drafts', 'cleanup_file_ids')) {
    await knex.schema.alterTable('comment_attachment_drafts', table => table.dropColumn('cleanup_file_ids'));
  }
  if (await knex.schema.hasColumn('comment_attachment_drafts', 'cleanup_completed_at')) {
    await knex.schema.alterTable('comment_attachment_drafts', table => table.dropColumn('cleanup_completed_at'));
  }
};
