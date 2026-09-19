const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_requester_reply_tokens';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.string('token', 80).notNullable(); table.string('delivery_key', 300).notNullable();
    table.string('recipient_kind', 24).notNullable(); table.uuid('client_id').notNullable(); table.uuid('recipient_id').notNullable();
    table.text('recipient_email').notNullable(); table.uuid('ticket_id').notNullable(); table.uuid('thread_id').notNullable(); table.uuid('comment_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).nullable(); table.timestamp('revoked_at', { useTz: true }).nullable();
    table.primary(['tenant', 'token']); table.unique(['tenant', 'delivery_key', 'recipient_email'], { indexName: 'co_management_requester_reply_delivery_idx' });
    table.check("recipient_kind IN ('requester_contact', 'requester_location')");
    table.check("token ~ '^cm1:[A-Za-z0-9_-]{43}$'");
    // Tokens must be excluded from portable exports; soft owner-local references
    // retain revocation/issuance evidence after requester or source deletion.
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot discard retained requester reply token history');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };
