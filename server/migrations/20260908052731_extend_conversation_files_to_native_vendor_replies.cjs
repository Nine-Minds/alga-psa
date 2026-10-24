const TABLE = 'co_management_conversation_attachments';
exports.up = async function (knex) {
  if (!await knex.schema.hasColumn(TABLE, 'external_author_email')) await knex.schema.alterTable(TABLE, t => {
    t.uuid('relationship_id').nullable().alter();
    t.uuid('actor_user_id').nullable().alter();
    t.string('external_author_email', 500).nullable();
    t.check('(actor_user_id IS NOT NULL AND external_author_email IS NULL) OR (actor_user_id IS NULL AND external_author_email IS NOT NULL)', [], 'conversation_file_author_identity');
  });
};
exports.down = async function (knex) {
  if (!await knex.schema.hasColumn(TABLE, 'external_author_email')) return;
  if (await knex(TABLE).whereNull('relationship_id').orWhereNull('actor_user_id').first()) throw new Error('Cannot discard retained native or external conversation files');
  await knex.schema.alterTable(TABLE, t => {
    t.dropChecks(['conversation_file_author_identity']); t.dropColumn('external_author_email');
    t.uuid('relationship_id').notNullable().alter(); t.uuid('actor_user_id').notNullable().alter();
  });
};
exports.config = { transaction: false };
