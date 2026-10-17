const TABLE = 'ticket_conversation_editor_drafts';
exports.up = async function (knex) {
  if (!await knex.schema.hasColumn(TABLE, 'reply_thread_id')) await knex.schema.alterTable(TABLE, t => {
    // Qualified through the draft's destination store and conversation. A foreign
    // private draft must never require a customer-store copy or cross-store FK.
    t.uuid('reply_thread_id').nullable();
    t.uuid('reply_comment_id').nullable();
    t.check('(reply_thread_id IS NULL) = (reply_comment_id IS NULL)', [], 'ticket_editor_reply_pair_check');
    t.check('reply_comment_id IS NULL OR content IS NOT NULL', [], 'ticket_editor_reply_content_check');
  });
};
exports.down = async function (knex) {
  if (!await knex.schema.hasColumn(TABLE, 'reply_thread_id')) return;
  if (await knex(TABLE).whereNotNull('reply_comment_id').first()) throw new Error('Cannot discard retained conversation draft reply targets');
  await knex.schema.alterTable(TABLE, t => {
    t.dropChecks(['ticket_editor_reply_pair_check', 'ticket_editor_reply_content_check']);
    t.dropColumns('reply_thread_id', 'reply_comment_id');
  });
};
