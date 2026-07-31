/**
 * Normalize project template dependency types to match project task
 * dependencies. The template editor used to store the UI-selected type
 * verbatim, including 'blocked_by' (its default), while
 * project_task_dependencies only permits 'blocks'/'related_to' via CHECK
 * constraint — so applying a template with a 'blocked_by' dependency failed
 * outright. Template rows are rewritten the same way addTaskDependency
 * normalizes input ("A blocked_by B" becomes "B blocks A"), and the same
 * CHECK constraint is added so the two tables can never diverge again.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  // Drop 'blocked_by' rows whose flipped equivalent already exists — the
  // flip below would otherwise create a duplicate pair.
  await knex.raw(`
    DELETE FROM project_template_dependencies d1
    WHERE d1.dependency_type = 'blocked_by'
      AND EXISTS (
        SELECT 1 FROM project_template_dependencies d2
        WHERE d2.tenant = d1.tenant
          AND d2.template_dependency_id <> d1.template_dependency_id
          AND d2.predecessor_task_id = d1.successor_task_id
          AND d2.successor_task_id = d1.predecessor_task_id
      )
  `);

  // "A blocked_by B" becomes "B blocks A" (RHS reads the pre-update values,
  // so the single-statement swap is safe).
  await knex.raw(`
    UPDATE project_template_dependencies
    SET predecessor_task_id = successor_task_id,
        successor_task_id = predecessor_task_id,
        dependency_type = 'blocks'
    WHERE dependency_type = 'blocked_by'
  `);

  await knex.raw(`
    ALTER TABLE project_template_dependencies
    DROP CONSTRAINT IF EXISTS project_template_dependencies_dependency_type_check
  `);

  await knex.raw(`
    ALTER TABLE project_template_dependencies
    ADD CONSTRAINT project_template_dependencies_dependency_type_check
    CHECK (dependency_type IN ('blocks', 'related_to'))
  `);
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE project_template_dependencies
    DROP CONSTRAINT IF EXISTS project_template_dependencies_dependency_type_check
  `);
};
