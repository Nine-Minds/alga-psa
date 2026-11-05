/**
 * Project staging (alga-2026-0002683 C6, repair): deleting a task must not silently cascade away its
 * staging lines. project_staging_lines_task_fk was ON DELETE CASCADE, which removed the lines while
 * reserved_quantity / held_quantity and allocated units stayed claimed (phantom claims). It becomes
 * NO ACTION: every task delete path first calls releaseStagingForTask (inventory lib), which releases live
 * claims and detaches installed/released lines and boxes (task_id = NULL), so the database now refuses any
 * path that skips it. SET NULL is not usable here: the composite key includes tenant, which is NOT NULL.
 *
 * The original migration is already applied on dev databases, so this is a forward migration.
 */
const { ensureCompositeFk, hasConstraint } = require('./utils/citusDistribution.cjs');

exports.config = { transaction: false };

const L = 'project_staging_lines';
const spec = (onDelete) => ({
  table: L,
  constraint: 'project_staging_lines_task_fk',
  columns: ['tenant', 'task_id'],
  referencedTable: 'project_tasks',
  referencedColumns: ['tenant', 'task_id'],
  onDelete,
});

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(L))) return;
  if (await hasConstraint(knex, L, 'project_staging_lines_task_fk')) {
    // migration-lint: allow 3 - retroactive: the FK is dropped and re-created immediately after by ensureCompositeFk with a different ON DELETE action; the lint cannot see through the helper
    await knex.raw(`ALTER TABLE ${L} DROP CONSTRAINT project_staging_lines_task_fk`);
  }
  await ensureCompositeFk(knex, spec('NO ACTION'));
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(L))) return;
  if (await hasConstraint(knex, L, 'project_staging_lines_task_fk')) {
    await knex.raw(`ALTER TABLE ${L} DROP CONSTRAINT project_staging_lines_task_fk`);
  }
  await ensureCompositeFk(knex, spec('CASCADE'));
};
