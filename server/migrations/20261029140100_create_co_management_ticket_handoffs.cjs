const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

// Co-managed L3b1: immutable handoff history (escalated / handed_back /
// access_revoked). (tenant, relationship, ticket, revision) is unique so two
// racing commands cannot both claim one revision. Rows are append-only in app
// code and cascade only with the owning work row.
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_management_ticket_handoffs'))) {
    await knex.schema.createTable('co_management_ticket_handoffs', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.uuid('ticket_id').notNullable();
      table.uuid('operation_id').notNullable();
      table.integer('revision').notNullable();
      table.text('transition').notNullable();
      table.text('request_fingerprint').notNullable();
      // Qualified historical identity; no source-tenant user FK or copied login.
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
  }
  await ensureTenantDistribution(knex, 'co_management_ticket_handoffs');
  await ensureCompositeFk(knex, { table: 'co_management_ticket_handoffs', constraint: 'co_ticket_handoff_work_fk', columns: ['tenant', 'relationship_id', 'ticket_id'], referencedTable: 'co_management_ticket_work', referencedColumns: ['tenant', 'relationship_id', 'ticket_id'], onDelete: 'CASCADE' });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('co_management_ticket_handoffs'))) return;
  if (await knex('co_management_ticket_handoffs').first()) {
    throw new Error('Cannot remove retained co-managed ticket handoffs');
  }
  await knex.schema.dropTable('co_management_ticket_handoffs');
};

exports.config = { transaction: false };
