const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_conversation_drafts';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('operation_id').notNullable();
    table.uuid('customer_tenant').notNullable(); table.uuid('relationship_id').notNullable(); table.uuid('ticket_id').notNullable(); table.uuid('thread_id').notNullable();
    table.uuid('actor_tenant').notNullable(); table.uuid('actor_user_id').notNullable();
    table.string('audience', 32).notNullable(); table.jsonb('request').notNullable(); table.jsonb('manifest').notNullable(); table.string('request_hash', 64).notNullable();
    table.string('status', 16).notNullable().defaultTo('draft'); table.jsonb('receipt').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()); table.timestamp('published_at', { useTz: true }).nullable();
    table.primary(['tenant', 'operation_id']);
    table.index(['tenant', 'actor_tenant', 'actor_user_id', 'status', 'created_at'], 'co_management_draft_actor_idx');
    table.check("audience IN ('requester', 'shared_it', 'organization_private')");
    table.check("(status = 'draft' AND receipt IS NULL AND published_at IS NULL) OR (status = 'published' AND receipt IS NOT NULL AND published_at IS NOT NULL)");
    table.check("jsonb_typeof(request) = 'object' AND request->>'operationId' = operation_id::text");
    table.check("jsonb_typeof(manifest) = 'array' AND jsonb_array_length(manifest) BETWEEN 1 AND 20");
    table.check("request_hash ~ '^[0-9a-f]{64}$'");
  });
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex.schema.hasColumn('co_management_conversation_attachments', 'draft_operation_id')) await knex.schema.alterTable('co_management_conversation_attachments', table => table.uuid('draft_operation_id').nullable());
  if (!await knex('pg_constraint').where('conname', 'co_management_attachment_draft_fk').whereRaw("conrelid = 'co_management_conversation_attachments'::regclass").first()) {
    await knex.schema.alterTable('co_management_conversation_attachments', table => table.foreign(['tenant', 'draft_operation_id'], 'co_management_attachment_draft_fk').references(['tenant', 'operation_id']).inTable(TABLE));
  }
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed conversation drafts');
  if (await knex.schema.hasColumn('co_management_conversation_attachments', 'draft_operation_id')) await knex.schema.alterTable('co_management_conversation_attachments', table => table.dropColumn('draft_operation_id'));
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
