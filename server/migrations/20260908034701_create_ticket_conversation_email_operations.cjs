const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const OPERATIONS = 'ticket_conversation_email_operations', ROUTES = 'ticket_conversation_email_routes';
exports.up = async function (knex) {
  if (!await knex.schema.hasColumn('ticket_conversation_editor_drafts', 'email_envelope')) await knex.schema.alterTable('ticket_conversation_editor_drafts', t => {
    t.jsonb('email_envelope').nullable();
    t.check("email_envelope IS NULL OR jsonb_typeof(email_envelope) = 'object'", [], 'ticket_editor_email_envelope_check');
  });
  if (!await knex.schema.hasColumn('ticket_conversation_publications', 'email_envelope')) await knex.schema.alterTable('ticket_conversation_publications', t => {
    t.jsonb('email_envelope').nullable();
  });
  if (!await knex.schema.hasTable(OPERATIONS)) await knex.schema.createTable(OPERATIONS, t => {
    // Reviews are author-private, including reviews of customer-owned destinations.
    t.uuid('tenant').notNullable(); t.uuid('operation_id').notNullable(); t.uuid('actor_user_id').notNullable();
    t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('relationship_id').nullable();
    t.uuid('conversation_store_tenant').notNullable(); t.uuid('conversation_id').notNullable();
    t.uuid('mailbox_tenant').notNullable(); t.uuid('mailbox_id').notNullable();
    t.integer('draft_revision').notNullable(); t.integer('conversation_revision').notNullable();
    t.string('request_hash', 64).notNullable(); t.jsonb('review').notNullable(); t.jsonb('payload').notNullable();
    t.string('reply_token_hash', 64).notNullable(); t.string('rfc_message_id', 255).notNullable();
    t.string('status', 16).notNullable().defaultTo('reviewed'); t.uuid('attempt_id').nullable();
    t.timestamp('attempted_at', { useTz: true }).nullable(); t.timestamp('completed_at', { useTz: true }).nullable();
    t.string('error_code', 100).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'operation_id']); t.index(['tenant', 'actor_user_id', 'conversation_store_tenant', 'conversation_id']);
    t.check("status IN ('reviewed', 'pending', 'sending', 'delivered', 'unknown', 'blocked')");
    t.check('draft_revision > 0 AND conversation_revision > 0');
    t.check("request_hash ~ '^[0-9a-f]{64}$' AND reply_token_hash ~ '^[0-9a-f]{64}$'");
  });
  if (!await knex.schema.hasTable(ROUTES)) await knex.schema.createTable(ROUTES, t => {
    // The receiving mailbox can resolve a route without scanning another tenant.
    t.uuid('tenant').notNullable(); t.uuid('mailbox_id').notNullable(); t.string('token_hash', 64).notNullable();
    t.uuid('operation_tenant').notNullable(); t.uuid('operation_id').notNullable();
    t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('relationship_id').nullable();
    t.uuid('conversation_store_tenant').notNullable(); t.uuid('conversation_id').notNullable();
    t.string('rfc_message_id', 255).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'mailbox_id', 'token_hash'], { constraintName: 'ticket_conversation_email_routes_pkey' });
    t.unique(['tenant', 'mailbox_id', 'rfc_message_id'], { indexName: 'ticket_conversation_email_routes_message_key' });
    t.foreign(['tenant', 'mailbox_id']).references(['tenant', 'id']).inTable('email_providers');
    t.index(['tenant', 'ticket_tenant', 'ticket_id']);
    t.check("token_hash ~ '^[0-9a-f]{64}$'");
  });
  await ensureTenantDistribution(knex, OPERATIONS); await ensureTenantDistribution(knex, ROUTES);
};
exports.down = async function (knex) {
  for (const table of [OPERATIONS, ROUTES]) if (await knex.schema.hasTable(table) && await knex(table).first()) throw new Error('Cannot discard retained conversation email operations');
  for (const table of ['ticket_conversation_editor_drafts', 'ticket_conversation_publications'])
    if (await knex.schema.hasColumn(table, 'email_envelope') && await knex(table).whereNotNull('email_envelope').first()) throw new Error('Cannot discard retained conversation email envelopes');
  await knex.schema.dropTableIfExists(ROUTES); await knex.schema.dropTableIfExists(OPERATIONS);
  if (await knex.schema.hasColumn('ticket_conversation_editor_drafts', 'email_envelope')) await knex.schema.alterTable('ticket_conversation_editor_drafts', t => {
    t.dropChecks(['ticket_editor_email_envelope_check']); t.dropColumn('email_envelope');
  });
  if (await knex.schema.hasColumn('ticket_conversation_publications', 'email_envelope')) await knex.schema.alterTable('ticket_conversation_publications', t => t.dropColumn('email_envelope'));
};
exports.config = { transaction: false };
