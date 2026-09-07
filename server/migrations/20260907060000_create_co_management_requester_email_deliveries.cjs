const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_requester_email_deliveries';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.string('delivery_key', 300).notNullable();
    table.string('recipient_kind', 24).notNullable(); table.uuid('client_id').notNullable(); table.uuid('recipient_id').notNullable();
    table.uuid('event_id').notNullable(); table.uuid('ticket_id').notNullable(); table.uuid('comment_id').notNullable(); table.uuid('thread_id').notNullable();
    table.string('status', 16).notNullable().defaultTo('pending'); table.integer('attempt_count').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at', { useTz: true }).nullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true }).nullable(); table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.string('error_code', 100).nullable();
    table.primary(['tenant', 'delivery_key']); table.index(['tenant', 'status', 'next_attempt_at'], 'co_management_requester_email_due_idx');
    table.check("recipient_kind IN ('requester_contact', 'requester_location') AND attempt_count >= 0");
    table.check("(status = 'pending' AND next_attempt_at IS NOT NULL AND completed_at IS NULL) OR (status IN ('delivered', 'skipped', 'failed') AND next_attempt_at IS NULL AND completed_at IS NOT NULL)");
    // Owner-local soft references retain completion history after source deletion.
    // Addresses and content are reloaded; reply-token bindings live separately.
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot discard retained requester email delivery history');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };
