/**
 * Co-managed IT L2: project scopes and MSP staff assignments (new tables only).
 *
 * No foreign keys (cross-tenant identities are qualified columns), no triggers
 * (Citus skips them); invariants live in CHECKs and app code. Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_management_project_scopes'))) {
    await knex.schema.createTable('co_management_project_scopes', (table) => {
      table.uuid('tenant').notNullable(); // Customer workspace.
      table.uuid('relationship_id').notNullable();
      table.uuid('project_id').notNullable();
      table.boolean('can_collaborate').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'relationship_id', 'project_id']);
    });
  }
  await ensureTenantDistribution(knex, 'co_management_project_scopes');

  if (!(await knex.schema.hasTable('co_management_staff_assignments'))) {
    await knex.schema.createTable('co_management_staff_assignments', (table) => {
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
};

exports.down = async function down(knex) {
  for (const table of ['co_management_staff_assignments', 'co_management_project_scopes']) {
    if ((await knex.schema.hasTable(table)) && (await knex(table).first())) {
      throw new Error('Cannot remove configured co-management collaboration policy');
    }
  }
  await knex.schema.dropTableIfExists('co_management_staff_assignments');
  await knex.schema.dropTableIfExists('co_management_project_scopes');
};

exports.config = { transaction: false };
