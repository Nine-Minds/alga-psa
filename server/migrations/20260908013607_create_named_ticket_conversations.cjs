const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'ticket_conversations';

exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    // Content ownership is distinct from the qualified ticket's ownership.
    table.uuid('tenant').notNullable();
    table.uuid('conversation_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('ticket_tenant').notNullable(); table.uuid('ticket_id').notNullable();
    table.uuid('relationship_id').nullable();
    table.string('name', 160).notNullable(); table.string('audience', 32).notNullable();
    table.string('transport', 16).notNullable(); table.string('default_slot', 32).nullable();
    table.string('status', 16).notNullable().defaultTo('open');
    table.integer('revision').notNullable().defaultTo(1);
    table.bigInteger('message_version').notNullable().defaultTo(0);
    table.uuid('mailbox_tenant').nullable(); table.uuid('mailbox_id').nullable();
    table.uuid('created_by_tenant').nullable(); table.uuid('created_by_user_id').nullable();
    table.string('creation_hash', 64).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'conversation_id']);
    table.unique(['tenant', 'ticket_tenant', 'ticket_id', 'default_slot'], { indexName: 'ticket_conversations_default_unique' });
    table.unique(['tenant', 'conversation_id', 'ticket_id'], { indexName: 'ticket_conversations_ticket_unique' });
    table.index(['tenant', 'ticket_tenant', 'ticket_id', 'created_at'], 'ticket_conversations_resource_idx');
    table.check('char_length(trim(name)) BETWEEN 1 AND 160');
    table.check("audience IN ('requester', 'shared_it', 'organization_private')");
    table.check("transport IN ('email', 'internal') AND status IN ('open', 'done')");
    table.check('revision > 0 AND message_version >= 0');
    table.check("tenant = ticket_tenant OR (audience = 'organization_private' AND relationship_id IS NOT NULL)");
    table.check("default_slot IS NULL OR (default_slot = audience AND ((default_slot = 'requester' AND tenant = ticket_tenant AND transport = 'email') OR (default_slot IN ('shared_it', 'organization_private') AND transport = 'internal')))");
    table.check('(mailbox_tenant IS NULL) = (mailbox_id IS NULL)');
    table.check("transport = 'email' OR mailbox_id IS NULL");
    table.check('(created_by_tenant IS NULL) = (created_by_user_id IS NULL)');
    table.check("creation_hash IS NULL OR creation_hash ~ '^[0-9a-f]{64}$'");
  });
  await ensureTenantDistribution(knex, TABLE);
  for (const [source, ticketColumn] of [['comment_threads', 'ticket_id'], ['co_management_private_threads', 'resource_id']]) {
    if (!await knex.schema.hasColumn(source, 'conversation_id')) await knex.schema.alterTable(source, table => table.uuid('conversation_id').nullable());
    const name = `${source}_named_conversation_fk`;
    if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [source]).first()) {
      await knex.schema.alterTable(source, table => table.foreign(['tenant', 'conversation_id', ticketColumn], name)
        .references(['tenant', 'conversation_id', 'ticket_id']).inTable(TABLE));
    }
  }
  // No message is rewritten. One audience container collects many existing roots.
  await knex.raw(`INSERT INTO ticket_conversations (tenant, ticket_tenant, ticket_id, name, audience, transport, default_slot)
    SELECT tenant, tenant, ticket_id, 'Requester', 'requester', 'email', 'requester' FROM tickets
    ON CONFLICT (tenant, ticket_tenant, ticket_id, default_slot) DO NOTHING`);
  // Leave inconsistent legacy root/reply flags for guarded read handling rather
  // than repairing them by silently widening their audience.
  const audience = `CASE WHEN t.collaboration_audience IS NOT NULL THEN t.collaboration_audience
    WHEN t.is_internal IS FALSE THEN 'requester' ELSE 'organization_private' END`;
  const valid = `t.ticket_id IS NOT NULL AND t.conversation_id IS NULL AND t.is_internal IS NOT NULL
    AND (t.collaboration_audience IS NULL OR t.is_internal = (t.collaboration_audience <> 'requester'))
    AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.tenant = t.tenant AND c.thread_id = t.thread_id
      AND (c.ticket_id IS DISTINCT FROM t.ticket_id OR c.is_internal IS DISTINCT FROM t.is_internal))`;
  await knex.raw(`INSERT INTO ticket_conversations (tenant, ticket_tenant, ticket_id, name, audience, transport, default_slot)
    SELECT DISTINCT t.tenant, t.tenant, t.ticket_id,
      CASE ${audience} WHEN 'requester' THEN 'Requester' WHEN 'shared_it' THEN 'Shared IT' ELSE 'Internal' END,
      ${audience}, CASE WHEN ${audience} = 'requester' THEN 'email' ELSE 'internal' END, ${audience}
    FROM comment_threads t WHERE ${valid}
    ON CONFLICT (tenant, ticket_tenant, ticket_id, default_slot) DO NOTHING`);
  await knex.raw(`UPDATE comment_threads t SET conversation_id = n.conversation_id FROM ticket_conversations n
    WHERE n.tenant = t.tenant AND n.ticket_tenant = t.tenant AND n.ticket_id = t.ticket_id
      AND n.default_slot = (${audience}) AND ${valid}`);
  await knex.raw(`INSERT INTO ticket_conversations (tenant, ticket_tenant, ticket_id, relationship_id, name, audience, transport, default_slot)
    SELECT DISTINCT tenant, customer_tenant, resource_id, relationship_id, 'Internal', 'organization_private', 'internal', 'organization_private'
    FROM co_management_private_threads WHERE resource_type = 'ticket' AND conversation_id IS NULL AND disclosure_operation_id IS NULL
    ON CONFLICT (tenant, ticket_tenant, ticket_id, default_slot) DO NOTHING`);
  await knex.raw(`UPDATE co_management_private_threads t SET conversation_id = n.conversation_id FROM ticket_conversations n
    WHERE t.resource_type = 'ticket' AND t.conversation_id IS NULL AND t.disclosure_operation_id IS NULL
      AND n.tenant = t.tenant AND n.ticket_tenant = t.customer_tenant AND n.ticket_id = t.resource_id
      AND n.relationship_id = t.relationship_id AND n.default_slot = 'organization_private'`);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained named ticket conversations');
  for (const table of ['comment_threads', 'co_management_private_threads']) {
    if (await knex.schema.hasColumn(table, 'conversation_id')) await knex.schema.alterTable(table, t => t.dropColumn('conversation_id'));
  }
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
