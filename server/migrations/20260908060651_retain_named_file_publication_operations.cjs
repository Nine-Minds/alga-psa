
const TABLE = 'co_management_conversation_attachments';
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'named_publication_operation_id')) await knex.schema.alterTable(TABLE, t => {
    t.uuid('named_publication_operation_id').nullable();
    t.check('named_publication_operation_id IS NULL OR (named_editor_conversation_id IS NULL AND named_publication_operation_id = comment_id)', [], 'conversation_file_named_publication');
    t.index(['tenant', 'named_publication_operation_id'], 'conversation_file_named_publication_idx');
  });
};
exports.down = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'named_publication_operation_id')) return;
  if (await knex(TABLE).whereNotNull('named_publication_operation_id').first()) throw new Error('Cannot discard retained named publication files');
  await knex.schema.alterTable(TABLE, t => {
    t.dropChecks(['conversation_file_named_publication']); t.dropIndex([], 'conversation_file_named_publication_idx'); t.dropColumn('named_publication_operation_id');
  });
};
exports.config = { transaction: false };
