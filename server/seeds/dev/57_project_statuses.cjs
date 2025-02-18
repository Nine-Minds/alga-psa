/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // Get the tenant ID
  const tenant = await knex('tenants').select('tenant').first();
  if (!tenant) return;

  // Pull a user with the given tenant
  const user = await knex('users')
    .where('tenant', tenant.tenant)
    .first();

  if (!user) {
    throw new Error('No user found for the given tenant');
  }

  // Define the statuses
  const statuses = [
    {
      name: 'Not Started',
      is_closed: false,
      order_number: 10,
      status_type: 'project',
      tenant: tenant.tenant,
      created_by: user.user_id,
    },
    {
      name: 'In Progress',
      is_closed: false,
      order_number: 20,
      status_type: 'project',
      tenant: tenant.tenant,
      created_by: user.user_id,
    },
    {
      name: 'On Hold',
      is_closed: false,
      order_number: 30,
      status_type: 'project',
      tenant: tenant.tenant,
      created_by: user.user_id,
    },
    {
      name: 'Completed',
      is_closed: true,
      order_number: 40,
      status_type: 'project',
      tenant: tenant.tenant,
      created_by: user.user_id,
    },
    {
      name: 'Cancelled',
      is_closed: true,
      order_number: 50,
      status_type: 'project',
      tenant: tenant.tenant,
      created_by: user.user_id,
    },
    {
      name: 'To Do',
      is_closed: false,
      order_number: 10,
      status_type: 'project_task',
      tenant: tenant.tenant,
      created_by: user.user_id,
    },
    {
      name: 'In Progress',
      is_closed: false,
      order_number: 20,
      status_type: 'project_task',
      tenant: tenant.tenant,
      created_by: user.user_id,
    },
    {
      name: 'On Hold',
      is_closed: false,
      order_number: 30,
      status_type: 'project_task',
      tenant: tenant.tenant,
      created_by: user.user_id,
    },
    {
      name: 'Completed',
      is_closed: true,
      order_number: 40,
      status_type: 'project_task',
      tenant: tenant.tenant,
      created_by: user.user_id,
    },
    {
      name: 'Cancelled',
      is_closed: true,
      order_number: 50,
      status_type: 'project_task',
      tenant: tenant.tenant,
      created_by: user.user_id,
    }
  ];

  // Insert statuses
  const insertedStatuses = await knex('statuses').insert(statuses).returning(['status_id', 'name', 'status_type']);

  // Get all projects
  const projects = await knex('projects').select('project_id');

  // Find the 'Not Started' status for projects
  const notStartedStatus = insertedStatuses.find(status => status.name === 'Not Started' && status.status_type === 'project');

  // Update projects with the 'Not Started' status
  if (notStartedStatus) {
    await Promise.all(projects.map(project => 
      knex('projects')
        .where('project_id', project.project_id)
        .update({ status: notStartedStatus.status_id })
    ));
  }
};
