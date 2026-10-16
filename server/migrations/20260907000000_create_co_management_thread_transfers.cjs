const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_thread_transfers';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('operation_id').notNullable(); table.uuid('customer_tenant').notNullable();
    table.uuid('relationship_id').notNullable(); table.uuid('ticket_id').notNullable(); table.uuid('source_thread_id').notNullable();
    table.uuid('actor_user_id').notNullable(); table.string('audience', 32).notNullable(); table.string('request_hash', 64).notNullable();
    table.string('source_snapshot', 64).notNullable(); table.jsonb('comment_map').notNullable(); table.jsonb('manifest').notNullable();
    table.string('status', 16).notNullable().defaultTo('prepared'); table.jsonb('receipt').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_activity_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('abandoned_at', { useTz: true }).nullable(); table.timestamp('cleaned_at', { useTz: true }).nullable();
    table.integer('cleanup_attempts').notNullable().defaultTo(0); table.string('cleanup_error_code', 64).nullable();
    table.timestamp('cleanup_next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'operation_id']); table.index(['tenant', 'status', 'last_activity_at'], 'co_management_thread_transfer_cleanup_idx');
    table.check('tenant <> customer_tenant'); table.check("audience IN ('requester', 'shared_it')");
    table.check("request_hash ~ '^[0-9a-f]{64}$' AND source_snapshot ~ '^[0-9a-f]{64}$'");
    table.check("jsonb_typeof(comment_map) = 'object' AND jsonb_typeof(manifest) = 'array'");
    table.check("(status = 'prepared' AND receipt IS NULL AND abandoned_at IS NULL) OR (status = 'published' AND receipt IS NOT NULL AND abandoned_at IS NULL) OR (status = 'abandoned' AND receipt IS NULL AND abandoned_at IS NOT NULL)");
    table.check("cleanup_attempts >= 0 AND (cleaned_at IS NULL OR status = 'abandoned')");
  });
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex.schema.hasColumn('co_management_private_threads', 'disclosure_operation_id')) await knex.schema.alterTable('co_management_private_threads', table => table.uuid('disclosure_operation_id').nullable());
  if (!await knex('pg_constraint').where('conname', 'co_management_private_thread_disclosure_fk').whereRaw('conrelid = ?::regclass', ['co_management_private_threads']).first())
    await knex.schema.alterTable('co_management_private_threads', table => table.foreign(['tenant', 'disclosure_operation_id'], 'co_management_private_thread_disclosure_fk').references(['tenant', 'operation_id']).inTable(TABLE));
  for (const column of ['disclosure_operation_id', 'disclosure_sponsor_tenant']) if (!await knex.schema.hasColumn('co_management_conversation_attachments', column))
    await knex.schema.alterTable('co_management_conversation_attachments', table => table.uuid(column).nullable());
  if (!await knex('pg_constraint').where('conname', 'co_management_attachment_disclosure_check').whereRaw('conrelid = ?::regclass', ['co_management_conversation_attachments']).first())
    await knex.raw(`ALTER TABLE co_management_conversation_attachments ADD CONSTRAINT co_management_attachment_disclosure_check CHECK (
      (disclosure_operation_id IS NULL AND disclosure_sponsor_tenant IS NULL) OR
      (disclosure_operation_id IS NOT NULL AND disclosure_sponsor_tenant IS NOT NULL AND disclosure_sponsor_tenant <> tenant AND status = 'ready' AND draft_operation_id IS NULL))`);
};
exports.down = async function (knex) {
  if (await knex(TABLE).first() || await knex('co_management_private_threads').whereNotNull('disclosure_operation_id').first() ||
    await knex('co_management_conversation_attachments').whereNotNull('disclosure_operation_id').first()) throw new Error('Cannot discard retained co-managed disclosure history');
  await knex.raw('ALTER TABLE co_management_conversation_attachments DROP CONSTRAINT IF EXISTS co_management_attachment_disclosure_check');
  await knex.schema.alterTable('co_management_conversation_attachments', table => table.dropColumns('disclosure_operation_id', 'disclosure_sponsor_tenant'));
  await knex.raw('ALTER TABLE co_management_private_threads DROP CONSTRAINT IF EXISTS co_management_private_thread_disclosure_fk');
  await knex.schema.alterTable('co_management_private_threads', table => table.dropColumn('disclosure_operation_id'));
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };
