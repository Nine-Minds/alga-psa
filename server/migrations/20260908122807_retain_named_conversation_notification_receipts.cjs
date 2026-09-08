const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const RECEIPTS = 'ticket_conversation_notification_receipts';
const EVENTS = 'ticket_conversation_message_events';
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn(EVENTS, 'in_app_fanout_at')) await knex.schema.alterTable(EVENTS, table => {
    table.timestamp('in_app_fanout_at', { useTz: true }).nullable();
    table.timestamp('in_app_retry_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['tenant', 'in_app_fanout_at', 'in_app_retry_at'], 'ticket_conversation_attention_pending_idx');
  });
  if (!await knex.schema.hasTable(RECEIPTS)) await knex.schema.createTable(RECEIPTS, table => {
    table.uuid('tenant').notNullable(); table.text('delivery_key').notNullable(); table.uuid('recipient_user_id').notNullable();
    table.uuid('source_store_tenant').notNullable(); table.uuid('conversation_id').notNullable();
    table.uuid('ticket_tenant').notNullable(); table.uuid('ticket_id').notNullable(); table.uuid('relationship_id').nullable();
    table.uuid('comment_id').notNullable(); table.uuid('thread_id').notNullable(); table.bigInteger('attention_sequence').notNullable();
    table.uuid('notification_id').nullable(); table.string('outcome', 16).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'delivery_key']); table.index(['tenant', 'notification_id']);
    table.check('attention_sequence > 0');
    table.check("(outcome IS NULL AND notification_id IS NULL) OR (outcome IS NOT NULL AND ((outcome = 'disabled' AND notification_id IS NULL) OR (outcome = 'created' AND notification_id IS NOT NULL)))");
    // Qualified soft source references survive source deletion without making
    // cached notification text a substitute for current read authority.
  });
  await ensureTenantDistribution(knex, RECEIPTS);
};
exports.down = async function(knex) {
  if (await knex.schema.hasTable(RECEIPTS) && await knex(RECEIPTS).first()) throw new Error('Retained conversation notification receipts prevent rollback');
  if (await knex.schema.hasColumn(EVENTS, 'in_app_fanout_at') && await knex(EVENTS).whereNotNull('in_app_fanout_at').first()) throw new Error('Retained conversation fanout prevents rollback');
  await knex.schema.dropTableIfExists(RECEIPTS);
  if (await knex.schema.hasColumn(EVENTS, 'in_app_fanout_at')) await knex.schema.alterTable(EVENTS, table => {
    table.dropIndex([], 'ticket_conversation_attention_pending_idx'); table.dropColumn('in_app_fanout_at'); table.dropColumn('in_app_retry_at');
  });
};
