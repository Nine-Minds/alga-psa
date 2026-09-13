const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'ticket_conversation_sender_grants';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, t => {
    t.uuid('tenant').notNullable(); t.uuid('mailbox_id').notNullable();
    t.uuid('conversation_store_tenant').notNullable(); t.uuid('conversation_id').notNullable();
    t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('relationship_id').notNullable();
    t.uuid('grantee_tenant').notNullable(); t.uuid('grantee_user_id').notNullable(); t.uuid('granted_by_user_id').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'mailbox_id', 'conversation_store_tenant', 'conversation_id', 'grantee_tenant', 'grantee_user_id'], { constraintName: 'ticket_conversation_senders_pkey' });
    t.foreign(['tenant', 'mailbox_id']).references(['tenant', 'id']).inTable('email_providers');
    t.index(['tenant', 'ticket_tenant', 'ticket_id']);
    t.check('tenant <> grantee_tenant');
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained conversation sender grants');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
