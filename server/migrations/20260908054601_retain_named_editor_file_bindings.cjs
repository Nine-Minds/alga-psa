
const TABLE = 'co_management_conversation_attachments';
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'named_editor_conversation_id')) await knex.schema.alterTable(TABLE, t => {
    t.uuid('thread_id').nullable().alter(); t.uuid('comment_id').nullable().alter();
    t.uuid('named_editor_store_tenant').nullable(); t.uuid('named_editor_conversation_id').nullable();
    t.check(`(named_editor_store_tenant IS NULL AND named_editor_conversation_id IS NULL AND thread_id IS NOT NULL AND comment_id IS NOT NULL)
      OR (named_editor_store_tenant IS NOT NULL AND named_editor_conversation_id IS NOT NULL AND thread_id IS NULL AND comment_id IS NULL
        AND draft_operation_id IS NULL AND actor_user_id IS NOT NULL AND external_author_email IS NULL AND tenant = actor_tenant)`, [], 'conversation_file_destination_binding');
    t.index(['tenant', 'actor_user_id', 'named_editor_store_tenant', 'named_editor_conversation_id'], 'conversation_file_editor_idx');
  });
};
exports.down = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'named_editor_conversation_id')) return;
  if (await knex(TABLE).whereNotNull('named_editor_conversation_id').first()) throw new Error('Cannot discard retained editor files');
  await knex.schema.alterTable(TABLE, t => {
    t.dropChecks(['conversation_file_destination_binding']);
    t.dropIndex([], 'conversation_file_editor_idx');
    t.dropColumns('named_editor_store_tenant', 'named_editor_conversation_id');
    t.uuid('thread_id').notNullable().alter(); t.uuid('comment_id').notNullable().alter();
  });
};
exports.config = { transaction: false };
