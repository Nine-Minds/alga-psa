const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'ticket_conversation_editor_drafts';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    // Drafts belong to the author's home store even when their destination is
    // customer-owned. Qualified soft references never grant destination access.
    table.uuid('tenant').notNullable(); table.uuid('actor_user_id').notNullable();
    table.uuid('conversation_store_tenant').notNullable(); table.uuid('conversation_id').notNullable();
    table.uuid('ticket_tenant').notNullable(); table.uuid('ticket_id').notNullable();
    table.jsonb('content').nullable();
    table.jsonb('attachment_manifest').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb('provenance').nullable();
    table.integer('revision').notNullable(); table.integer('conversation_revision').notNullable();
    table.uuid('last_operation_id').notNullable(); table.string('last_request_hash', 64).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'actor_user_id', 'conversation_store_tenant', 'conversation_id'], { constraintName: 'ticket_editor_drafts_pkey' });
    table.index(['tenant', 'ticket_tenant', 'ticket_id', 'actor_user_id'], 'ticket_editor_drafts_resource_idx');
    table.check('revision > 0 AND conversation_revision > 0');
    table.check("content IS NULL OR jsonb_typeof(content) = 'object'");
    table.check("jsonb_typeof(attachment_manifest) = 'array'");
    table.check("provenance IS NULL OR jsonb_typeof(provenance) = 'object'");
    table.check("last_request_hash ~ '^[0-9a-f]{64}$'");
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained conversation editor drafts');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
