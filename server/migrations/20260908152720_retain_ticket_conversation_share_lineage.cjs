const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'ticket_conversation_shares';
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn('ticket_conversation_publications', 'share_operation_id'))
    await knex.schema.alterTable('ticket_conversation_publications', t => t.uuid('share_operation_id').nullable());
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, t => {
    // Private provenance belongs to the preparing author's home organization,
    // even when a reviewed destination copy belongs to the customer.
    t.uuid('tenant').notNullable(); t.uuid('operation_id').notNullable(); t.uuid('actor_user_id').notNullable();
    t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('relationship_id').nullable();
    t.uuid('destination_store_tenant').notNullable(); t.uuid('destination_conversation_id').notNullable();
    t.string('request_hash', 64).notNullable(); t.jsonb('source').notNullable(); t.boolean('quote').notNullable();
    t.jsonb('attachment_manifest').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    t.uuid('published_comment_id').nullable(); t.uuid('published_thread_id').nullable();
    t.jsonb('published_editor_attachment_ids').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('published_at', { useTz: true }).nullable();
    t.primary(['tenant', 'operation_id']);
    t.index(['tenant', 'ticket_tenant', 'ticket_id'], 'ticket_conversation_shares_ticket_idx');
    t.unique(['tenant', 'destination_store_tenant', 'destination_conversation_id', 'published_comment_id'], 'ticket_conversation_shares_copy_key');
    t.check("request_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(source) = 'object' AND jsonb_typeof(attachment_manifest) = 'array'");
    t.check(`(published_comment_id IS NULL AND published_thread_id IS NULL AND published_at IS NULL AND published_editor_attachment_ids IS NULL)
      OR (published_comment_id IS NOT NULL AND published_thread_id IS NOT NULL AND published_at IS NOT NULL
        AND published_editor_attachment_ids IS NOT NULL AND jsonb_typeof(published_editor_attachment_ids) = 'array')`);
    // Soft, fully qualified references: deleting a source or its organization
    // never cascades into the independent, already published destination copy.
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function(knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained conversation share lineage');
  if (await knex.schema.hasColumn('ticket_conversation_publications', 'share_operation_id') &&
    await knex('ticket_conversation_publications').whereNotNull('share_operation_id').first()) throw new Error('Cannot discard retained conversation share lineage');
  await knex.schema.dropTableIfExists(TABLE);
  if (await knex.schema.hasColumn('ticket_conversation_publications', 'share_operation_id'))
    await knex.schema.alterTable('ticket_conversation_publications', t => t.dropColumn('share_operation_id'));
};
exports.config = { transaction: false };
