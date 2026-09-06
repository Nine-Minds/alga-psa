const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function (knex) {
  if (!await knex.schema.hasTable('co_management_relationship_events')) {
    await knex.schema.createTable('co_management_relationship_events', table => {
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
      table.unique(['tenant', 'relationship_id', 'revision']);
      table.check('revision > 0');
    });
  }
  await ensureTenantDistribution(knex, 'co_management_relationship_events');
};

exports.down = async function (knex) {
  if (await knex('co_management_relationship_events').first()) throw new Error('Cannot remove relationship acceptance history');
  await knex.schema.dropTable('co_management_relationship_events');
};
exports.config = { transaction: false };
