const TABLE = 'co_management_conversation_attachments';
exports.up = async function (knex) {
  for (const column of ['removal_actor_tenant', 'removal_actor_user_id']) {
    if (!await knex.schema.hasColumn(TABLE, column)) await knex.schema.alterTable(TABLE, table => table.uuid(column).nullable());
  }
  if (!await knex('pg_constraint').where('conname', 'co_management_attachment_removal_check').whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_management_attachment_removal_check CHECK (
      (removal_actor_tenant IS NULL AND removal_actor_user_id IS NULL) OR
      (removal_actor_tenant IS NOT NULL AND removal_actor_user_id IS NOT NULL AND status = 'ready' AND discarded_at IS NOT NULL
       AND removal_actor_tenant = actor_tenant AND removal_actor_user_id = actor_user_id))`, [TABLE]);
  }
};
exports.down = async function (knex) {
  if (await knex(TABLE).whereNotNull('removal_actor_tenant').first()) throw new Error('Cannot discard retained co-managed attachment removal history');
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS co_management_attachment_removal_check', [TABLE]);
  await knex.schema.alterTable(TABLE, table => table.dropColumns('removal_actor_tenant', 'removal_actor_user_id'));
};
exports.config = { transaction: false };
