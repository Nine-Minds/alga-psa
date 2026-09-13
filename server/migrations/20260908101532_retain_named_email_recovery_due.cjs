const TABLE = 'ticket_conversation_email_operations';
exports.up = async function (knex) {
  if (!await knex.schema.hasColumn(TABLE, 'recovery_after')) await knex.schema.alterTable(TABLE, t => {
    t.timestamp('recovery_after', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['tenant', 'status', 'recovery_after'], 'named_email_recovery_due_idx');
  });
};
exports.down = async function (knex) {
  if (await knex.schema.hasColumn(TABLE, 'recovery_after')) await knex.schema.alterTable(TABLE, t => {
    t.dropIndex(['tenant', 'status', 'recovery_after'], 'named_email_recovery_due_idx');
    t.dropColumn('recovery_after');
  });
};
