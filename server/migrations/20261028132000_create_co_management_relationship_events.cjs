/**
 * Relationship event history (CM L1a). Owned by the CUSTOMER workspace tenant.
 *
 * Unique `(tenant, relationship_id, revision, event_type)`: one event per
 * transition type per revision, so `requested` and `prepared` can both be
 * recorded at revision 1 and every transition is safe under retry.
 * Zero foreign keys, distributed on `tenant` colocated with `tenants`.
 * Idempotent; safe to re-run.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_management_relationship_events'))) {
    await knex.schema.createTable('co_management_relationship_events', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('event_id').notNullable();
      table.uuid('relationship_id').notNullable();
      table.uuid('actor_tenant').notNullable();
      table.uuid('actor_user_id').notNullable();
      table.text('event_type').notNullable();
      table.integer('revision').notNullable();
      table.jsonb('scope').notNullable();
      table.text('scope_fingerprint').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'event_id']);
      table.unique(['tenant', 'relationship_id', 'revision', 'event_type']);
      table.check('revision > 0');
    });
  }
  await ensureTenantDistribution(knex, 'co_management_relationship_events');
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('co_management_relationship_events'))) return;
  if (await knex('co_management_relationship_events').first()) {
    throw new Error('Cannot remove relationship acceptance history');
  }
  await knex.schema.dropTable('co_management_relationship_events');
};

// Citus distribution is performed outside Knex's migration transaction.
exports.config = { transaction: false };
