const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_event_outbox';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('event_id').notNullable(); table.uuid('ticket_id').notNullable(); table.uuid('comment_id').notNullable();
    table.uuid('thread_id').notNullable(); table.string('event_type', 64).notNullable(); table.string('audience', 32).notNullable();
    table.jsonb('publication').notNullable(); table.string('request_hash', 64).notNullable(); table.string('status', 16).notNullable().defaultTo('pending');
    table.integer('attempts').notNullable().defaultTo(0); table.string('error_code', 64).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true }).nullable();
    table.primary(['tenant', 'event_id']); table.index(['tenant', 'status', 'next_attempt_at'], 'co_management_event_outbox_due_idx');
    table.check("event_type IN ('TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED', 'TICKET_RESPONSE_STATE_CHANGED', 'TICKET_MESSAGE_ADDED', 'TICKET_INTERNAL_NOTE_ADDED', 'TICKET_CUSTOMER_REPLIED')");
    table.check("audience IN ('requester', 'shared_it', 'organization_private')"); table.check("jsonb_typeof(publication) = 'object'");
    table.check("request_hash ~ '^[0-9a-f]{64}$' AND attempts >= 0");
    table.check("(status = 'pending' AND completed_at IS NULL) OR (status IN ('published', 'cancelled') AND completed_at IS NOT NULL)");
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed event delivery history');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };
