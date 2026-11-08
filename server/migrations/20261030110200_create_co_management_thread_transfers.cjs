// CM L4b (3 of 5): the immutable record of one thread disclosure (prepared -> published | abandoned),
// with the source->target comment map, the file manifest and the cleanup bookkeeping for an
// abandoned copy. New table only; Citus-distributed. Invariants live in application code.
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_thread_transfers';
exports.config = { transaction: false };
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
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed disclosure history');
  await knex.schema.dropTableIfExists(TABLE);
};
