/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // Get the tenant ID
  const tenant = await knex('tenants').select('tenant').first();
  if (!tenant) return;

  await knex('standard_statuses').insert([
    // Project statuses
    { name: 'Planned', item_type: 'project', display_order: 1, tenant: tenant.tenant },
    { name: 'In Progress', item_type: 'project', display_order: 2, tenant: tenant.tenant },
    { name: 'On Hold', item_type: 'project', display_order: 3, tenant: tenant.tenant },
    { name: 'Completed', item_type: 'project', display_order: 4, tenant: tenant.tenant, is_closed: 'true' },
    { name: 'Cancelled', item_type: 'project', display_order: 5, tenant: tenant.tenant, is_closed: 'true' },

    // Project task statuses (colors and icons are in the statuses table, not standard_statuses)
    { name: 'To Do', item_type: 'project_task', display_order: 1, tenant: tenant.tenant },
    { name: 'In Progress', item_type: 'project_task', display_order: 2, tenant: tenant.tenant },
    { name: 'In Review', item_type: 'project_task', display_order: 3, tenant: tenant.tenant },
    { name: 'Done', item_type: 'project_task', display_order: 4, tenant: tenant.tenant, is_closed: 'true' },
    { name: 'Blocked', item_type: 'project_task', display_order: 5, tenant: tenant.tenant },

    // Ticket statuses
    { name: 'Open', item_type: 'ticket', display_order: 1, tenant: tenant.tenant, is_default: 'true' },
    { name: 'In Progress', item_type: 'ticket', display_order: 2, tenant: tenant.tenant },
    { name: 'Waiting for Customer', item_type: 'ticket', display_order: 3, tenant: tenant.tenant },
    { name: 'Resolved', item_type: 'ticket', display_order: 4, tenant: tenant.tenant, is_closed: 'true' },
    { name: 'Closed', item_type: 'ticket', display_order: 5, tenant: tenant.tenant, is_closed: 'true' },

    // Interaction statuses
    { name: 'Planned', item_type: 'interaction', display_order: 1, tenant: tenant.tenant },
    { name: 'In Progress', item_type: 'interaction', display_order: 2, tenant: tenant.tenant },
    { name: 'Completed', item_type: 'interaction', display_order: 3, tenant: tenant.tenant, is_closed: 'true', is_default: 'true' },
    { name: 'Cancelled', item_type: 'interaction', display_order: 4, tenant: tenant.tenant, is_closed: 'true' }
  ]);
};
