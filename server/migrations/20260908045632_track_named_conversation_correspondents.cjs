const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'ticket_conversation_email_correspondents';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, t => {
    // A mailbox-owned reservation index, never an access or admission grant.
    t.uuid('tenant').notNullable(); t.uuid('mailbox_id').notNullable(); t.string('email', 500).notNullable();
    t.uuid('conversation_store_tenant').notNullable(); t.uuid('conversation_id').notNullable();
    t.string('route_token_hash', 64).notNullable();
    t.primary(['tenant', 'mailbox_id', 'email', 'conversation_store_tenant', 'conversation_id'], { constraintName: 'ticket_conversation_correspondents_pkey' });
    t.foreign(['tenant', 'mailbox_id', 'route_token_hash'], 'ticket_conversation_correspondent_route_fk')
      .references(['tenant', 'mailbox_id', 'token_hash']).inTable('ticket_conversation_email_routes');
    t.check('email = lower(trim(email)) AND length(email) > 0');
  });
  await ensureTenantDistribution(knex, TABLE);
  await knex.raw(`CREATE INDEX IF NOT EXISTS ticket_conversation_inbound_rfc_idx
    ON ticket_conversation_inbound_receipts (tenant, provider_id, (envelope->>'messageId'))`);
  // Follow qualified stores when backfilling accepted sends and external authors.
  const routes = await knex('ticket_conversation_email_routes').select('*');
  for (const route of routes) {
    const publication = await knex('ticket_conversation_publications').where({ tenant: route.conversation_store_tenant,
      conversation_id: route.conversation_id, ticket_tenant: route.ticket_tenant, ticket_id: route.ticket_id,
      actor_tenant: route.operation_tenant, operation_id: route.operation_id, mode: 'send' }).first('email_envelope');
    const replies = await knex('ticket_conversation_inbound_receipts').where({ tenant: route.tenant, provider_id: route.mailbox_id,
      route_operation_tenant: route.operation_tenant, route_operation_id: route.operation_id }).select('envelope');
    const own = new Set((await knex('email_providers').where('tenant', route.tenant).select('mailbox')).map(row => row.mailbox.trim().toLowerCase()));
    const emails = new Set([...(publication?.email_envelope?.to ?? []), ...(publication?.email_envelope?.cc ?? []),
      ...replies.map(row => row.envelope.from)].map(value => value?.email?.trim().toLowerCase()).filter(value => value && !own.has(value)));
    for (const email of emails) await knex(TABLE).insert({ tenant: route.tenant, mailbox_id: route.mailbox_id, email,
      conversation_store_tenant: route.conversation_store_tenant, conversation_id: route.conversation_id, route_token_hash: route.token_hash }).onConflict().ignore();
  }
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained conversation correspondent reservations');
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP INDEX IF EXISTS ticket_conversation_inbound_rfc_idx');
};
exports.config = { transaction: false };
