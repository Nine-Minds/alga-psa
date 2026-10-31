const { ensureCompositeFk } = require('./utils/citusDistribution.cjs');

// CM L6a2 (6): the work-level soft default billing profile for MSP time on shared work. Nullable and
// metadata-only (no rewrite, no default), so it is expand-only. Contract attribution still wins; null
// leaves native client/default resolution. The FK is a plain own-tenant composite FK (RESTRICT).
const TABLES = [
  ['co_managed_ticket_references', 'co_ticket_reference_profile_fk'],
  ['co_managed_project_task_references', 'co_task_reference_profile_fk'],
];

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('client_billing_profiles'))) return;
  for (const [table, constraint] of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, 'billing_profile_id'))) {
      await knex.schema.alterTable(table, (builder) => builder.uuid('billing_profile_id').nullable());
    }
    await ensureCompositeFk(knex, { table, constraint, columns: ['tenant', 'billing_profile_id'],
      referencedTable: 'client_billing_profiles', referencedColumns: ['tenant', 'billing_profile_id'], onDelete: 'RESTRICT' });
  }
};

exports.down = async function down(knex) {
  for (const [table, constraint] of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
    if (await knex.schema.hasColumn(table, 'billing_profile_id')) {
      await knex.schema.alterTable(table, (builder) => builder.dropColumn('billing_profile_id'));
    }
  }
};
