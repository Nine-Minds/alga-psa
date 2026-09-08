const TABLES = ['co_management_conversation_attachments', 'co_managed_archive_files'];
exports.up = async knex => {
  for (const table of TABLES) {
    if (!await knex.schema.hasColumn(table, 'project_task_id')) await knex.schema.alterTable(table, t => t.uuid('project_task_id').nullable());
    await knex.raw('ALTER TABLE ?? ALTER COLUMN ticket_id DROP NOT NULL', [table]);
    const constraint = table === TABLES[0] ? 'co_attachment_parent_check' : 'co_archive_file_parent_check';
    if (!await knex('pg_constraint').where('conname', constraint).whereRaw('conrelid = ?::regclass', [table]).first())
      await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (num_nonnulls(ticket_id, project_task_id) = 1)', [table, constraint]);
  }
  if (!await knex('pg_constraint').where('conname', 'co_task_attachment_publication_check').whereRaw('conrelid = ?::regclass', [TABLES[0]]).first())
    await knex.raw('ALTER TABLE ?? ADD CONSTRAINT co_task_attachment_publication_check CHECK (project_task_id IS NULL OR (draft_operation_id IS NULL AND disclosure_operation_id IS NULL))', [TABLES[0]]);
  await knex.raw('CREATE INDEX IF NOT EXISTS co_attachment_task_comment_idx ON co_management_conversation_attachments (tenant, customer_tenant, relationship_id, project_task_id, thread_id, comment_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS co_archive_file_task_idx ON co_managed_archive_files (tenant, customer_tenant, relationship_id, project_task_id, captured_at, archive_file_id)');
  // Keep the existing identity/content trigger. A separate fence survives replay
  // of its earlier migration, which did not know about the task parent column.
  await knex.raw(`CREATE OR REPLACE FUNCTION co_archive_file_task_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.project_task_id IS DISTINCT FROM OLD.project_task_id THEN
      RAISE EXCEPTION 'Retained archive task identity is immutable' USING ERRCODE = '23514';
    END IF; RETURN NEW; END; $$`);
  await knex.raw('DROP TRIGGER IF EXISTS co_archive_file_task_immutable ON co_managed_archive_files');
  await knex.raw('CREATE TRIGGER co_archive_file_task_immutable BEFORE UPDATE ON co_managed_archive_files FOR EACH ROW EXECUTE FUNCTION co_archive_file_task_immutable()');
};
exports.down = async knex => {
  for (const table of TABLES) if (await knex(table).whereNotNull('project_task_id').first()) throw new Error('Cannot discard retained task attachments');
  await knex.raw('DROP TRIGGER IF EXISTS co_archive_file_task_immutable ON co_managed_archive_files');
  await knex.raw('DROP FUNCTION IF EXISTS co_archive_file_task_immutable()');
  await knex.raw('ALTER TABLE co_management_conversation_attachments DROP CONSTRAINT co_task_attachment_publication_check');
  await knex.raw('DROP INDEX IF EXISTS co_attachment_task_comment_idx');
  await knex.raw('DROP INDEX IF EXISTS co_archive_file_task_idx');
  for (const table of TABLES) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [table, table === TABLES[0] ? 'co_attachment_parent_check' : 'co_archive_file_parent_check']);
    await knex.raw('ALTER TABLE ?? ALTER COLUMN ticket_id SET NOT NULL', [table]);
    await knex.schema.alterTable(table, t => t.dropColumn('project_task_id'));
  }
};
