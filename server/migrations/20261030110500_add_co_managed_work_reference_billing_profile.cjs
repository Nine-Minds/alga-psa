const { ensureCompositeFk } = require('./utils/citusDistribution.cjs');

// CM L6a2 (6): the work-level soft default billing profile for MSP time on shared work. Nullable and
// metadata-only (no rewrite, no default), so it is expand-only. Contract attribution still wins; null
// leaves native client/default resolution. The FK is a plain own-tenant composite FK (RESTRICT).
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('client_billing_profiles'))) return;
  if (await knex.schema.hasTable('co_managed_ticket_references')) {
    if (!(await knex.schema.hasColumn('co_managed_ticket_references', 'billing_profile_id'))) {
      await knex.schema.alterTable('co_managed_ticket_references', (table) => table.uuid('billing_profile_id').nullable());
    }
    await ensureCompositeFk(knex, { table: 'co_managed_ticket_references', constraint: 'co_ticket_reference_profile_fk',
      columns: ['tenant', 'billing_profile_id'], referencedTable: 'client_billing_profiles',
      referencedColumns: ['tenant', 'billing_profile_id'], onDelete: 'RESTRICT' });
  }
  if (await knex.schema.hasTable('co_managed_project_task_references')) {
    if (!(await knex.schema.hasColumn('co_managed_project_task_references', 'billing_profile_id'))) {
      await knex.schema.alterTable('co_managed_project_task_references', (table) => table.uuid('billing_profile_id').nullable());
    }
    await ensureCompositeFk(knex, { table: 'co_managed_project_task_references', constraint: 'co_task_reference_profile_fk',
      columns: ['tenant', 'billing_profile_id'], referencedTable: 'client_billing_profiles',
      referencedColumns: ['tenant', 'billing_profile_id'], onDelete: 'RESTRICT' });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('co_managed_ticket_references')) {
    await knex.raw('ALTER TABLE co_managed_ticket_references DROP CONSTRAINT IF EXISTS co_ticket_reference_profile_fk');
    if (await knex.schema.hasColumn('co_managed_ticket_references', 'billing_profile_id')) {
      await knex.schema.alterTable('co_managed_ticket_references', (table) => table.dropColumn('billing_profile_id'));
    }
  }
  if (await knex.schema.hasTable('co_managed_project_task_references')) {
    await knex.raw('ALTER TABLE co_managed_project_task_references DROP CONSTRAINT IF EXISTS co_task_reference_profile_fk');
    if (await knex.schema.hasColumn('co_managed_project_task_references', 'billing_profile_id')) {
      await knex.schema.alterTable('co_managed_project_task_references', (table) => table.dropColumn('billing_profile_id'));
    }
  }
};
