const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLES = ['co_management_ticket_work', 'co_management_ticket_handoffs', 'co_managed_ticket_references'];

exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLES[0])) await knex.schema.createTable(TABLES[0], table => {
    table.uuid('tenant').notNullable();
    table.uuid('relationship_id').notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('work_id').notNullable();
    table.integer('revision').notNullable();
    table.text('responsibility').notNullable();
    table.boolean('can_collaborate').notNullable().defaultTo(true);
    table.timestamp('grant_revoked_at', { useTz: true }).nullable();
    table.timestamp('first_escalated_at', { useTz: true }).notNullable();
    table.timestamp('last_transition_at', { useTz: true }).notNullable();
    table.primary(['tenant', 'relationship_id', 'ticket_id']);
    table.unique(['tenant', 'work_id']);
    table.check('revision > 0');
    table.check("responsibility IN ('customer', 'msp')");
  });
  if (!await knex.schema.hasTable(TABLES[1])) await knex.schema.createTable(TABLES[1], table => {
    table.uuid('tenant').notNullable();
    table.uuid('relationship_id').notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('operation_id').notNullable();
    table.integer('revision').notNullable();
    table.text('transition').notNullable();
    table.text('request_fingerprint').notNullable();
    table.uuid('actor_tenant').notNullable();
    table.uuid('actor_user_id').notNullable();
    table.text('actor_name').notNullable();
    table.text('actor_organization').notNullable();
    table.text('note').notNullable();
    table.text('audience').notNullable().defaultTo('shared_it');
    table.timestamp('occurred_at', { useTz: true }).notNullable();
    table.primary(['tenant', 'operation_id']);
    table.unique(['tenant', 'relationship_id', 'ticket_id', 'revision']);
    table.check('revision > 0');
    table.check("transition IN ('escalated', 'handed_back', 'access_revoked')");
    table.check("request_fingerprint ~ '^[0-9a-f]{64}$'");
    table.check("audience = 'shared_it'");
    table.check('char_length(note) BETWEEN 1 AND 10000');
  });
  if (!await knex.schema.hasTable(TABLES[2])) await knex.schema.createTable(TABLES[2], table => {
    table.uuid('tenant').notNullable(); // MSP-owned routing, never a second ticket.
    table.uuid('reference_id').notNullable();
    table.uuid('customer_tenant').notNullable();
    table.uuid('relationship_id').notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('work_id').notNullable();
    table.uuid('client_id').notNullable();
    table.uuid('board_id').notNullable();
    table.uuid('assigned_to').nullable();
    table.uuid('assigned_team_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table.primary(['tenant', 'reference_id']);
    table.unique(['tenant', 'customer_tenant', 'relationship_id', 'ticket_id']);
    table.check('tenant <> customer_tenant');
  });
  for (const table of TABLES) await ensureTenantDistribution(knex, table);
  // Customer-local history cascades with the owning ticket. MSP references have
  // no cross-tenant FKs and survive departure/deletion for billing and archives.
  for (const [table, name, columns, parent, parentColumns, onDelete] of [
    [TABLES[0], 'co_ticket_work_relationship_fk', ['tenant', 'relationship_id'], 'co_management_relationships', ['tenant', 'relationship_id'], 'CASCADE'],
    [TABLES[0], 'co_ticket_work_ticket_fk', ['tenant', 'ticket_id'], 'tickets', ['tenant', 'ticket_id'], 'CASCADE'],
    [TABLES[1], 'co_ticket_handoff_work_fk', ['tenant', 'relationship_id', 'ticket_id'], TABLES[0], ['tenant', 'relationship_id', 'ticket_id'], 'CASCADE'],
    [TABLES[2], 'co_ticket_reference_owner_fk', ['tenant'], 'tenants', ['tenant'], 'CASCADE'],
    [TABLES[2], 'co_ticket_reference_client_fk', ['tenant', 'client_id'], 'clients', ['tenant', 'client_id'], 'RESTRICT'],
    [TABLES[2], 'co_ticket_reference_board_fk', ['tenant', 'board_id'], 'boards', ['tenant', 'board_id'], 'RESTRICT'],
  ]) {
    if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [table]).first()) {
      await knex.schema.alterTable(table, builder => builder.foreign(columns, name).references(parentColumns).inTable(parent).onDelete(onDelete));
    }
  }
};
exports.down = async function (knex) {
  for (const table of TABLES) if (await knex(table).first()) throw new Error('Cannot remove retained co-management ticket handoffs');
  for (const table of [...TABLES].reverse()) await knex.schema.dropTable(table);
};
exports.config = { transaction: false };
