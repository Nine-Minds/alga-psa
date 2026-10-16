const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
exports.up = async function (knex) {
  if (!await knex.schema.hasColumn('co_management_relationships', 'escalation_board_id')) {
    await knex.schema.alterTable('co_management_relationships', table => {
      table.uuid('escalation_board_id').nullable(); // Qualified by sponsor_tenant.
    });
  }
  if (!await knex.schema.hasTable('co_management_board_scopes')) {
    await knex.schema.createTable('co_management_board_scopes', table => {
      table.uuid('tenant').notNullable(); // Customer-owned, explicitly selected boards.
      table.uuid('relationship_id').notNullable();
      table.uuid('board_id').notNullable();
      table.boolean('can_collaborate').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'relationship_id', 'board_id']);
    });
  }
  await ensureTenantDistribution(knex, 'co_management_board_scopes');
};
exports.down = async function (knex) {
  if (await knex('co_management_board_scopes').first() || await knex('co_management_relationships').whereNotNull('escalation_board_id').first()) {
    throw new Error('Cannot roll back configured co-management scopes');
  }
  await knex.schema.dropTable('co_management_board_scopes');
  await knex.schema.alterTable('co_management_relationships', table => table.dropColumn('escalation_board_id'));
};
exports.config = { transaction: false };
