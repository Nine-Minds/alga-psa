const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_customer_reply_tokens';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.string('token', 80).notNullable(); table.string('delivery_key', 300).notNullable();
    table.uuid('recipient_user_id').notNullable(); table.string('audience', 32).notNullable();
    table.text('recipient_email').notNullable(); table.uuid('ticket_id').notNullable(); table.uuid('thread_id').notNullable(); table.uuid('comment_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).nullable(); table.timestamp('revoked_at', { useTz: true }).nullable();
    table.primary(['tenant', 'token']); table.unique(['tenant', 'delivery_key', 'recipient_email'], { indexName: 'co_management_customer_reply_delivery_idx' });
    table.check("audience IN ('requester', 'shared_it', 'organization_private')");
    table.check("token ~ '^cm2:[A-Za-z0-9_-]{43}$'");
    // Tokens must be excluded from portable exports; soft owner-local references
    // retain revocation/issuance evidence after recipient or source deletion.
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot discard retained customer technician reply token history');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };
