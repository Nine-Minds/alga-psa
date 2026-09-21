const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_managed_project_task_references';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); // MSP-owned participation, never a copied task.
    table.uuid('reference_id').notNullable();
    table.uuid('customer_tenant').notNullable();
    table.uuid('relationship_id').notNullable();
    table.uuid('task_id').notNullable();
    table.uuid('client_id').notNullable();
    table.uuid('assigned_to').nullable();
    table.uuid('assigned_team_id').nullable();
    table.boolean('active').notNullable();
    table.integer('revision').notNullable();
    table.text('assignee_name').notNullable();
    table.text('organization_name').notNullable();
    table.text('task_name').notNullable();
    table.text('project_name').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table.primary(['tenant', 'reference_id']);
    table.unique(['tenant', 'customer_tenant', 'relationship_id', 'task_id']);
    table.check('tenant <> customer_tenant AND revision > 0');
    table.check('(assigned_to IS NOT NULL)::int + (assigned_team_id IS NOT NULL)::int = 1');
  });
  await ensureTenantDistribution(knex, TABLE);
  // Qualified source and historical assignees survive source/user deletion.
  for (const [name, columns, parent, parentColumns] of [
    ['co_task_reference_owner_fk', ['tenant'], 'tenants', ['tenant']],
    ['co_task_reference_client_fk', ['tenant', 'client_id'], 'clients', ['tenant', 'client_id']],
  ]) if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [TABLE]).first())
    await knex.schema.alterTable(TABLE, table => table.foreign(columns, name).references(parentColumns).inTable(parent));
};
exports.down = async function(knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove retained co-managed task participation');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
