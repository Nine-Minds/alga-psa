/**
 * Add completed field to project_template_checklist_items table
 * This allows templates to have pre-completed checklist items
 *
 * Uses 3-step pattern for Citus compatibility:
 * 1. Add nullable column
 * 2. Backfill existing rows with default value
 * 3. Set NOT NULL constraint with default
 */

exports.up = async function(knex) {
  // Check if column already exists (idempotency)
  const hasColumn = await knex.schema.hasColumn('project_template_checklist_items', 'completed');
  if (hasColumn) {
    console.log('Column "completed" already exists, skipping');
    return;
  }

  // Step 1: Add nullable column (no lock contention on distributed shards)
  await knex.schema.alterTable('project_template_checklist_items', (table) => {
    table.boolean('completed');
  });

  // Step 2: Backfill existing rows with default value
  await knex('project_template_checklist_items')
    .whereNull('completed')
    .update({ completed: false });

  // Step 3: Set NOT NULL constraint and default
  await knex.schema.alterTable('project_template_checklist_items', (table) => {
    table.boolean('completed').defaultTo(false).notNullable().alter();
  });
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('project_template_checklist_items', 'completed');
  if (!hasColumn) {
    console.log('Column "completed" does not exist, skipping');
    return;
  }

  await knex.schema.alterTable('project_template_checklist_items', (table) => {
    table.dropColumn('completed');
  });
};
