/**
 * Make created_by/user_id nullable on tables that support system-created records:
 * - project_templates.created_by: allows system-seeded templates
 * - jobs.user_id: allows system-scheduled jobs (e.g., createNextTimePeriods)
 */
exports.up = async function(knex) {
  console.log('Making project_templates.created_by nullable...');
  await knex.schema.alterTable('project_templates', (table) => {
    table.uuid('created_by').nullable().alter();
  });
  console.log('project_templates.created_by is now nullable');

  console.log('Making jobs.user_id nullable...');
  await knex.schema.alterTable('jobs', (table) => {
    table.uuid('user_id').nullable().alter();
  });
  console.log('jobs.user_id is now nullable');
};

exports.down = async function(knex) {
  // Note: These will fail if there are null values in the columns
  await knex.schema.alterTable('project_templates', (table) => {
    table.uuid('created_by').notNullable().alter();
  });

  await knex.schema.alterTable('jobs', (table) => {
    table.uuid('user_id').notNullable().alter();
  });
};
