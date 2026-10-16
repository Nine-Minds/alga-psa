const DRAFTS = 'co_management_conversation_drafts', FILES = 'co_management_conversation_attachments';
exports.up = async function (knex) {
  for (const table of [DRAFTS, FILES]) {
    if (!await knex.schema.hasColumn(table, 'last_activity_at')) {
      await knex.schema.alterTable(table, t => t.timestamp('last_activity_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()));
      await knex(table).update({ last_activity_at: knex.ref('created_at') });
    }
  }
  for (const [table, columns] of [[DRAFTS, ['abandoned_at', 'cleanup_completed_at']], [FILES, ['discarded_at', 'purged_at', 'cleanup_next_attempt_at']]]) {
    for (const column of columns) if (!await knex.schema.hasColumn(table, column)) await knex.schema.alterTable(table, t => {
      const field = t.timestamp(column, { useTz: true });
      if (column === 'cleanup_next_attempt_at') field.notNullable().defaultTo(knex.fn.now()); else field.nullable();
    });
  }
  if (!await knex.schema.hasColumn(FILES, 'cleanup_attempts')) await knex.schema.alterTable(FILES, t => t.integer('cleanup_attempts').notNullable().defaultTo(0));
  if (!await knex.schema.hasColumn(FILES, 'cleanup_error_code')) await knex.schema.alterTable(FILES, t => t.string('cleanup_error_code', 64).nullable());
  for (const [table, name, check] of [
    [DRAFTS, 'co_management_draft_abandoned_check', "(abandoned_at IS NULL OR status = 'draft') AND (cleanup_completed_at IS NULL OR abandoned_at IS NOT NULL)"],
    [FILES, 'co_management_attachment_purge_check', 'cleanup_attempts >= 0 AND (purged_at IS NULL OR discarded_at IS NOT NULL)'],
  ]) if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [table]).first()) await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (' + check + ')', [table, name]);
  await knex.raw('CREATE INDEX IF NOT EXISTS co_management_draft_cleanup_idx ON ?? (tenant, last_activity_at) WHERE status = \'draft\' AND cleanup_completed_at IS NULL', [DRAFTS]);
  await knex.raw("CREATE INDEX IF NOT EXISTS co_management_attachment_pending_cleanup_idx ON ?? (tenant, last_activity_at) WHERE status = 'pending' AND draft_operation_id IS NULL AND discarded_at IS NULL", [FILES]);
  await knex.raw('CREATE INDEX IF NOT EXISTS co_management_attachment_cleanup_idx ON ?? (tenant, cleanup_next_attempt_at) WHERE discarded_at IS NOT NULL AND purged_at IS NULL', [FILES]);
};
exports.down = async function (knex) {
  if (await knex(DRAFTS).whereNotNull('abandoned_at').first() || await knex(FILES).whereNotNull('discarded_at').first()) throw new Error('Cannot discard retained co-managed upload cleanup history');
  await knex.raw('DROP INDEX IF EXISTS co_management_draft_cleanup_idx');
  await knex.raw('DROP INDEX IF EXISTS co_management_attachment_cleanup_idx');
  await knex.raw('DROP INDEX IF EXISTS co_management_attachment_pending_cleanup_idx');
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS co_management_draft_abandoned_check', [DRAFTS]);
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS co_management_attachment_purge_check', [FILES]);
  await knex.schema.alterTable(DRAFTS, t => t.dropColumns('last_activity_at', 'abandoned_at', 'cleanup_completed_at'));
  await knex.schema.alterTable(FILES, t => t.dropColumns('last_activity_at', 'discarded_at', 'purged_at', 'cleanup_next_attempt_at', 'cleanup_attempts', 'cleanup_error_code'));
};
exports.config = { transaction: false };
