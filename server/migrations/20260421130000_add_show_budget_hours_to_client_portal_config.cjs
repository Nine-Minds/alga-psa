/**
 * Add show_budget_hours flag to client_portal_config on projects and project_templates.
 * Defaults to false (hidden) to match the rest of the client portal visibility flags.
 */
exports.config = { transaction: false };

const NEW_DEFAULT_CLIENT_PORTAL_CONFIG = {
  show_phases: false,
  show_phase_completion: false,
  show_tasks: false,
  show_budget_hours: false,
  visible_task_fields: ['task_name', 'due_date', 'status']
};

async function backfillTable(knex, tableName, idColumn) {
  // CitusDB requires select-then-update with tenant in WHERE clause.
  const rows = await knex(tableName).select(idColumn, 'tenant', 'client_portal_config');

  let updated = 0;
  for (const row of rows) {
    const current = row.client_portal_config || {};
    if (Object.prototype.hasOwnProperty.call(current, 'show_budget_hours')) {
      continue;
    }
    const next = { ...current, show_budget_hours: false };
    await knex(tableName)
      .where(idColumn, row[idColumn])
      .andWhere('tenant', row.tenant)
      .update({ client_portal_config: JSON.stringify(next) });
    updated += 1;
  }
  return updated;
}

exports.up = async function (knex) {
  console.log('Adding show_budget_hours to client_portal_config defaults...');

  await knex.schema.alterTable('projects', (table) => {
    table.jsonb('client_portal_config').defaultTo(JSON.stringify(NEW_DEFAULT_CLIENT_PORTAL_CONFIG)).alter();
  });
  console.log('  ✓ Updated default for projects.client_portal_config');

  await knex.schema.alterTable('project_templates', (table) => {
    table.jsonb('client_portal_config').defaultTo(JSON.stringify(NEW_DEFAULT_CLIENT_PORTAL_CONFIG)).alter();
  });
  console.log('  ✓ Updated default for project_templates.client_portal_config');

  const projectsUpdated = await backfillTable(knex, 'projects', 'project_id');
  console.log(`  ✓ Backfilled show_budget_hours on ${projectsUpdated} projects`);

  const templatesUpdated = await backfillTable(knex, 'project_templates', 'template_id');
  console.log(`  ✓ Backfilled show_budget_hours on ${templatesUpdated} project_templates`);

  console.log('show_budget_hours added to client_portal_config successfully');
};

const PREVIOUS_DEFAULT_CLIENT_PORTAL_CONFIG = {
  show_phases: false,
  show_phase_completion: false,
  show_tasks: false,
  visible_task_fields: ['task_name', 'due_date', 'status']
};

exports.down = async function (knex) {
  console.log('Reverting show_budget_hours from client_portal_config defaults...');

  await knex.schema.alterTable('projects', (table) => {
    table.jsonb('client_portal_config').defaultTo(JSON.stringify(PREVIOUS_DEFAULT_CLIENT_PORTAL_CONFIG)).alter();
  });
  console.log('  ✓ Reverted default for projects.client_portal_config');

  await knex.schema.alterTable('project_templates', (table) => {
    table.jsonb('client_portal_config').defaultTo(JSON.stringify(PREVIOUS_DEFAULT_CLIENT_PORTAL_CONFIG)).alter();
  });
  console.log('  ✓ Reverted default for project_templates.client_portal_config');

  // Strip show_budget_hours from existing rows.
  async function strip(tableName, idColumn) {
    const rows = await knex(tableName).select(idColumn, 'tenant', 'client_portal_config');
    for (const row of rows) {
      const current = row.client_portal_config || {};
      if (!Object.prototype.hasOwnProperty.call(current, 'show_budget_hours')) {
        continue;
      }
      const { show_budget_hours: _omit, ...rest } = current;
      await knex(tableName)
        .where(idColumn, row[idColumn])
        .andWhere('tenant', row.tenant)
        .update({ client_portal_config: JSON.stringify(rest) });
    }
  }

  await strip('projects', 'project_id');
  await strip('project_templates', 'template_id');

  console.log('show_budget_hours reverted successfully');
};
