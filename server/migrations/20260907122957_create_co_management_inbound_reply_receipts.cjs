const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_inbound_reply_receipts';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('inbox_id').notNullable();
    table.uuid('ticket_id').notNullable(); table.uuid('thread_id').notNullable(); table.uuid('comment_id').notNullable();
    table.uuid('source_ticket_id').notNullable(); table.uuid('source_thread_id').notNullable(); table.uuid('source_comment_id').notNullable();
    table.uuid('actor_tenant').notNullable(); table.uuid('actor_user_id').notNullable();
    table.uuid('relationship_id').notNullable(); table.string('audience', 32).notNullable();
    table.string('source_sha256', 64).notNullable(); table.string('reply_token_hash', 64).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'inbox_id']); table.unique(['tenant', 'comment_id']);
    table.check("audience IN ('requester', 'shared_it', 'organization_private')");
    table.check('actor_tenant = tenant');
    table.check("source_sha256 ~ '^[a-f0-9]{64}$' AND reply_token_hash ~ '^[a-f0-9]{64}$'");
    // Owner-local soft references preserve accepted-mail evidence after token,
    // source, or user deletion. No reply credential, address, or body is copied.
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot discard retained inbound reply receipts');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };
