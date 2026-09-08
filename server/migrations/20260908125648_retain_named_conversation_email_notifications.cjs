const TABLE = 'co_management_email_deliveries', EVENTS = 'ticket_conversation_message_events';
const { removeResourceChecks, installResourceCheck } = require('./utils/coManagedEmailDeliveryResource.cjs');
exports.up = async function(knex) {
  for (const column of ['conversation_store_tenant', 'conversation_id'])
    if (!await knex.schema.hasColumn(TABLE, column)) await knex.schema.alterTable(TABLE, table => table.uuid(column).nullable());
  if (!await knex.schema.hasColumn(TABLE, 'attention_sequence')) await knex.schema.alterTable(TABLE, table => table.bigInteger('attention_sequence').nullable());
  await knex.raw('ALTER TABLE ?? ALTER COLUMN relationship_id DROP NOT NULL', [TABLE]);
  await installResourceCheck(knex);
  if (!await knex.schema.hasColumn(EVENTS, 'email_fanout_at')) await knex.schema.alterTable(EVENTS, table => table.timestamp('email_fanout_at', { useTz: true }).nullable());
  if (!await knex.schema.hasColumn(EVENTS, 'email_retry_at')) await knex.schema.alterTable(EVENTS, table => table.timestamp('email_retry_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()));
  await knex.raw('CREATE INDEX IF NOT EXISTS ticket_conversation_email_fanout_due ON ?? (tenant, email_retry_at) WHERE email_fanout_at IS NULL', [EVENTS]);
};
exports.down = async function(knex) {
  if (await knex(TABLE).where('resource_type', 'ticket_conversation').first() || await knex(EVENTS).whereNotNull('email_fanout_at').first())
    throw new Error('Cannot discard retained conversation email notifications');
  await removeResourceChecks(knex);
  await knex.schema.alterTable(TABLE, table => { table.dropColumn('conversation_store_tenant'); table.dropColumn('conversation_id'); table.dropColumn('attention_sequence'); });
  await knex.raw('ALTER TABLE ?? ALTER COLUMN relationship_id SET NOT NULL', [TABLE]);
  await installResourceCheck(knex);
  await knex.schema.alterTable(EVENTS, table => { table.dropColumn('email_fanout_at'); table.dropColumn('email_retry_at'); });
};
