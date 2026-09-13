const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const RECEIPTS = 'ticket_conversation_inbound_receipts', MESSAGES = 'ticket_conversation_inbound_messages';
exports.up = async function (knex) {
  if (!await knex.schema.hasColumn('co_management_private_comments', 'actor_kind')) {
    await knex.schema.alterTable('co_management_private_comments', t => {
      t.uuid('actor_user_id').nullable().alter();
      t.string('actor_kind', 16).notNullable().defaultTo('user');
      t.string('external_author_email', 500).nullable();
      t.check("(actor_kind = 'user' AND actor_user_id IS NOT NULL AND external_author_email IS NULL) OR (actor_kind = 'external' AND actor_user_id IS NULL AND external_author_email IS NOT NULL)", [], 'private_comment_author_identity_check');
    });
  }
  if (!await knex.schema.hasTable(RECEIPTS)) await knex.schema.createTable(RECEIPTS, t => {
    // The durable source and intake receipt stay with the receiving mailbox.
    t.uuid('tenant').notNullable(); t.uuid('inbox_id').notNullable(); t.uuid('provider_id').notNullable();
    t.text('normalized_message_id').notNullable(); t.string('source_sha256', 64).notNullable();
    t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('relationship_id').nullable();
    t.uuid('conversation_store_tenant').notNullable(); t.uuid('conversation_id').notNullable();
    t.uuid('thread_id').notNullable(); t.uuid('comment_id').notNullable();
    t.uuid('route_operation_tenant').notNullable(); t.uuid('route_operation_id').notNullable();
    t.jsonb('sender_auth').notNullable(); t.jsonb('envelope').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'inbox_id']);
    t.unique(['tenant', 'provider_id', 'normalized_message_id'], { indexName: 'ticket_conversation_inbound_source_key' });
    t.check("source_sha256 ~ '^[0-9a-f]{64}$'");
    t.index(['tenant', 'ticket_tenant', 'ticket_id']);
  });
  if (!await knex.schema.hasTable(MESSAGES)) await knex.schema.createTable(MESSAGES, t => {
    // Published envelope evidence follows its audience's content store.
    t.uuid('tenant').notNullable(); t.uuid('comment_id').notNullable(); t.uuid('thread_id').notNullable();
    t.uuid('conversation_id').notNullable(); t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable();
    t.uuid('mailbox_tenant').notNullable(); t.uuid('mailbox_id').notNullable(); t.uuid('inbox_id').notNullable();
    t.jsonb('envelope').notNullable(); t.jsonb('proposed_recipients').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'comment_id']);
    t.foreign(['tenant', 'conversation_id', 'ticket_id']).references(['tenant', 'conversation_id', 'ticket_id']).inTable('ticket_conversations');
    t.index(['tenant', 'conversation_id', 'created_at']);
  });
  await ensureTenantDistribution(knex, RECEIPTS); await ensureTenantDistribution(knex, MESSAGES);
};
exports.down = async function (knex) {
  for (const table of [RECEIPTS, MESSAGES]) if (await knex.schema.hasTable(table) && await knex(table).first()) throw new Error('Cannot discard retained vendor replies');
  if (await knex.schema.hasColumn('co_management_private_comments', 'actor_kind')) {
    if (await knex('co_management_private_comments').where('actor_kind', 'external').first()) throw new Error('Cannot discard external private authors');
    await knex.schema.alterTable('co_management_private_comments', t => {
      t.dropChecks(['private_comment_author_identity_check']); t.dropColumn('external_author_email'); t.dropColumn('actor_kind'); t.uuid('actor_user_id').notNullable().alter();
    });
  }
  await knex.schema.dropTableIfExists(MESSAGES); await knex.schema.dropTableIfExists(RECEIPTS);
};
exports.config = { transaction: false };
