exports.up = async function (knex) {
  if (!await knex.schema.hasColumn('inbound_email_artifacts', 'conversation_attachment_id')) {
    await knex.schema.alterTable('inbound_email_artifacts', table => table.uuid('conversation_attachment_id').nullable());
  }
};
exports.down = async function (knex) {
  if (await knex('inbound_email_artifacts').whereNotNull('conversation_attachment_id').first()) throw new Error('Cannot discard retained conversation artifact links');
  await knex.schema.alterTable('inbound_email_artifacts', table => table.dropColumn('conversation_attachment_id'));
};
