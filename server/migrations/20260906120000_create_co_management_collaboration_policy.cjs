const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function (knex) {
  // Foreign customer/principal identities are always qualified, without cross-shard FKs.
  if (!await knex.schema.hasTable('co_management_project_scopes')) {
    await knex.schema.createTable('co_management_project_scopes', table => {
      table.uuid('tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.uuid('project_id').notNullable();
      table.boolean('can_collaborate').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'relationship_id', 'project_id']);
    });
  }
  await ensureTenantDistribution(knex, 'co_management_project_scopes');
  if (!await knex.schema.hasTable('co_management_staff_assignments')) {
    await knex.schema.createTable('co_management_staff_assignments', table => {
      table.uuid('tenant').notNullable(); // MSP home workspace.
      table.uuid('customer_tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.text('principal_type').notNullable();
      table.uuid('principal_id').notNullable(); // User/team in tenant, never customer.
      table.text('relationship_role').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'customer_tenant', 'relationship_id', 'principal_type', 'principal_id']);
      table.check('tenant <> customer_tenant');
      table.check("principal_type IN ('user', 'team')");
      table.check("relationship_role IN ('viewer', 'technician')");
    });
  }
  await ensureTenantDistribution(knex, 'co_management_staff_assignments');
  // Add local FKs after distribution so both sides are colocated on Citus.
  for (const [table, name, columns, parent, parentColumns] of [
    ['co_management_project_scopes', 'co_project_scope_relationship_fk', ['tenant', 'relationship_id'], 'co_management_relationships', ['tenant', 'relationship_id']],
    ['co_management_project_scopes', 'co_project_scope_project_fk', ['tenant', 'project_id'], 'projects', ['tenant', 'project_id']],
    ['co_management_staff_assignments', 'co_staff_assignment_owner_fk', ['tenant'], 'tenants', ['tenant']],
  ]) {
    const exists = await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [table]).first();
    if (!exists) await knex.schema.alterTable(table, builder => {
      builder.foreign(columns, name).references(parentColumns).inTable(parent).onDelete('CASCADE');
    });
  }
};
exports.down = async function (knex) {
  for (const table of ['co_management_staff_assignments', 'co_management_project_scopes']) {
    if (await knex(table).first()) throw new Error('Cannot remove configured co-management collaboration policy');
  }
  await knex.schema.dropTable('co_management_staff_assignments');
  await knex.schema.dropTable('co_management_project_scopes');
};
exports.config = { transaction: false };
