const { ensureTenantDistribution, supportsDistributedForeignKeyTarget } = require('./utils/citusDistribution.cjs');
const TABLE = 'ticket_conversation_sender_grants';
exports.up = async function (knex) {
  const providerFkSupported = await supportsDistributedForeignKeyTarget(knex, 'email_providers');
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, t => {
    t.uuid('tenant').notNullable(); t.uuid('mailbox_id').notNullable();
    t.uuid('conversation_store_tenant').notNullable(); t.uuid('conversation_id').notNullable();
    t.uuid('ticket_tenant').notNullable(); t.uuid('ticket_id').notNullable(); t.uuid('relationship_id').notNullable();
    t.uuid('grantee_tenant').notNullable(); t.uuid('grantee_user_id').notNullable(); t.uuid('granted_by_user_id').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['tenant', 'mailbox_id', 'conversation_store_tenant', 'conversation_id', 'grantee_tenant', 'grantee_user_id'], { constraintName: 'ticket_conversation_senders_pkey' });
    if (providerFkSupported) t.foreign(['tenant', 'mailbox_id']).references(['tenant', 'id']).inTable('email_providers');
    t.index(['tenant', 'ticket_tenant', 'ticket_id']);
    t.check('tenant <> grantee_tenant');
  });
  // Match outbound sender addresses: providers can remain local on Citus.
  // Mailbox admission still validates the tenant-scoped provider in the app.
  // Also repair a partial run that created the FK before distribution failed.
  if (!providerFkSupported) await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`,
    [TABLE, 'ticket_conversation_sender_grants_tenant_mailbox_id_foreign']);
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained conversation sender grants');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
