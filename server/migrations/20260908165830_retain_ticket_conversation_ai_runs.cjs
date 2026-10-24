const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'ticket_conversation_ai_runs';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, t => {
    t.uuid('tenant').notNullable(); t.uuid('operation_id').notNullable(); t.uuid('actor_user_id').notNullable();
    t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('relationship_id').nullable();
    t.uuid('destination_store_tenant').notNullable(); t.uuid('destination_conversation_id').notNullable();
    t.string('kind', 24).notNullable(); t.string('request_hash', 64).notNullable(); t.jsonb('request').notNullable();
    t.jsonb('source_snapshot').notNullable(); t.string('status', 16).notNullable();
    t.uuid('attempt_id').notNullable(); t.timestamp('lease_expires_at', { useTz: true }).notNullable();
    t.text('generated_text').nullable(); t.integer('prepared_draft_revision').nullable(); t.string('failure_code', 64).nullable();
    t.uuid('published_comment_id').nullable(); t.uuid('published_thread_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'operation_id']);
    t.index(['tenant', 'ticket_tenant', 'ticket_id'], 'ticket_conversation_ai_runs_ticket_idx');
    t.check("kind IN ('synthesis', 'conversation_reply') AND status IN ('running', 'completed', 'failed', 'cancelled')");
    t.check("request_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(request) = 'object' AND jsonb_typeof(source_snapshot) = 'object'");
    t.check("(status = 'completed' AND generated_text IS NOT NULL AND prepared_draft_revision IS NOT NULL) OR (status <> 'completed' AND generated_text IS NULL AND prepared_draft_revision IS NULL)");
    t.check('(published_comment_id IS NULL AND published_thread_id IS NULL) OR (published_comment_id IS NOT NULL AND published_thread_id IS NOT NULL AND status = \'completed\')');
    // Author-home ownership and qualified soft references prevent a source or
    // destination deletion from deleting another organization's retained data.
  });
  if (!await knex.schema.hasColumn('ticket_conversation_publications', 'ai_run_operation_id'))
    await knex.schema.alterTable('ticket_conversation_publications', t => t.uuid('ai_run_operation_id').nullable());
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function(knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained conversation AI runs');
  if (await knex.schema.hasColumn('ticket_conversation_publications', 'ai_run_operation_id') &&
    await knex('ticket_conversation_publications').whereNotNull('ai_run_operation_id').first()) throw new Error('Cannot discard retained conversation AI runs');
  await knex.schema.dropTableIfExists(TABLE);
  if (await knex.schema.hasColumn('ticket_conversation_publications', 'ai_run_operation_id'))
    await knex.schema.alterTable('ticket_conversation_publications', t => t.dropColumn('ai_run_operation_id'));
};
exports.config = { transaction: false };
