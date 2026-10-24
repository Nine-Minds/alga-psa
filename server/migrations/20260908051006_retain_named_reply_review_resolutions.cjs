const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'ticket_conversation_reply_resolutions';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, t => {
    t.uuid('tenant').notNullable(); t.uuid('operation_id').notNullable(); t.uuid('inbox_id').notNullable();
    t.uuid('actor_user_id').notNullable(); t.string('request_hash', 64).notNullable(); t.string('source_sha256', 64).notNullable();
    t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('relationship_id').nullable();
    t.uuid('conversation_store_tenant').notNullable(); t.uuid('conversation_id').notNullable(); t.uuid('comment_id').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'operation_id']); t.unique(['tenant', 'inbox_id']);
    t.foreign(['tenant', 'inbox_id']).references(['tenant', 'inbox_id']).inTable('inbound_email_inbox');
    t.check("request_hash ~ '^[0-9a-f]{64}$' AND source_sha256 ~ '^[0-9a-f]{64}$'");
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained reply resolutions');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
