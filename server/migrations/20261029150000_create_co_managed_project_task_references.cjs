/**
 * Co-managed IT L3c: MSP-owned participation references for shared project tasks (new table only).
 *
 * `tenant` is the MSP and `customer_tenant` is recorded; `task_id` points into the customer's
 * workspace, so there is deliberately NO foreign key to `project_tasks` (cross-tenant FKs are not
 * representable). FKs go only to this tenant's own `tenants` and `clients` rows. The MSP assignee
 * lives here and never on `project_tasks.assigned_to` / `task_resources`, which stay the customer's.
 * `revision` counts shared commands; customer-side drift is caught by comparing
 * `project_tasks.updated_at` in app code (no triggers: Citus skips them). Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'co_managed_project_task_references';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable(); // MSP-owned participation, never a copied task.
      table.uuid('reference_id').notNullable();
      table.uuid('customer_tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.uuid('task_id').notNullable();
      table.uuid('client_id').notNullable(); // MSP-side client that represents the customer.
      table.uuid('assigned_to').nullable(); // MSP user, never a customer user. Exactly one of user/team.
      table.uuid('assigned_team_id').nullable(); // MSP team.
      table.boolean('active').notNullable().defaultTo(true);
      table.integer('revision').notNullable().defaultTo(1);
      table.text('assignee_name').notNullable().defaultTo('');
      table.text('organization_name').notNullable().defaultTo('');
      table.text('task_name').notNullable().defaultTo('');
      table.text('project_name').notNullable().defaultTo('');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'reference_id']);
      table.unique(['tenant', 'customer_tenant', 'relationship_id', 'task_id'], { indexName: 'co_task_reference_task_uq' });
      table.check('tenant <> customer_tenant AND revision > 0', [], 'co_task_reference_owner_revision_ck');
      table.check('(assigned_to IS NOT NULL)::int + (assigned_team_id IS NOT NULL)::int = 1', [], 'co_task_reference_one_assignee_ck');
    });
  }
  await ensureTenantDistribution(knex, TABLE);

  for (const [name, columns, parent, parentColumns] of [
    ['co_task_reference_owner_fk', ['tenant'], 'tenants', ['tenant']],
    ['co_task_reference_client_fk', ['tenant', 'client_id'], 'clients', ['tenant', 'client_id']],
  ]) {
    const exists = await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [TABLE]).first();
    if (!exists) {
      await knex.schema.alterTable(TABLE, (table) => table.foreign(columns, name).references(parentColumns).inTable(parent));
    }
  }
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove retained co-managed task participation');
  }
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
