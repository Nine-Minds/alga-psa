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

    // Project task statuses with colors and icons
    { name: 'To Do', item_type: 'project_task', display_order: 1, tenant: tenant.tenant, color: '#6B7280', icon: 'Clipboard' },
    { name: 'In Progress', item_type: 'project_task', display_order: 2, tenant: tenant.tenant, color: '#3B82F6', icon: 'PlayCircle' },
    { name: 'In Review', item_type: 'project_task', display_order: 3, tenant: tenant.tenant, color: '#8B5CF6', icon: 'Activity' },
    { name: 'Done', item_type: 'project_task', display_order: 4, tenant: tenant.tenant, is_closed: 'true', color: '#10B981', icon: 'CheckCircle' },
    { name: 'Blocked', item_type: 'project_task', display_order: 5, tenant: tenant.tenant, color: '#EF4444', icon: 'AlertCircle' },

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
