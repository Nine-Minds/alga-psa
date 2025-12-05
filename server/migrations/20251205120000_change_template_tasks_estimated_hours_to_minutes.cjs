/**
 * Migration: Change project_template_tasks.estimated_hours to store minutes
 *
 * This migration changes estimated_hours from decimal (storing hours) to bigint (storing minutes)
 * to match the project_tasks table, which also stores estimated_hours in minutes.
 *
 * Data conversion:
 * - Existing values are multiplied by 60 (hours → minutes)
 * - e.g., 1.5 hours becomes 90 minutes
 */

exports.up = async function(knex) {
  // First, convert existing data from hours to minutes (multiply by 60)
  await knex.raw(`
    UPDATE project_template_tasks
    SET estimated_hours = ROUND(estimated_hours * 60)
    WHERE estimated_hours IS NOT NULL
  `);

  // Then change the column type to bigint
  await knex.raw(`
    ALTER TABLE project_template_tasks
    ALTER COLUMN estimated_hours TYPE BIGINT
    USING ROUND(estimated_hours)::BIGINT
  `);
};

exports.down = async function(knex) {
  // Convert back to decimal storing hours
  await knex.raw(`
    ALTER TABLE project_template_tasks
    ALTER COLUMN estimated_hours TYPE DECIMAL(10,2)
    USING (estimated_hours / 60.0)::DECIMAL(10,2)
  `);
};
