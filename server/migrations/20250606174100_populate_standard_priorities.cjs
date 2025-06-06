exports.up = async function(knex) {
  // Insert standard priorities for tickets
  await knex('standard_priorities').insert([
    {
      priority_name: 'Low',
      priority_level: 70,
      color: '#9CA3AF',
      item_type: 'ticket'
    },
    {
      priority_name: 'Medium',
      priority_level: 50,
      color: '#F59E0B',
      item_type: 'ticket'
    },
    {
      priority_name: 'High',
      priority_level: 30,
      color: '#EF4444',
      item_type: 'ticket'
    },
    {
      priority_name: 'Urgent',
      priority_level: 10,
      color: '#DC2626',
      item_type: 'ticket'
    }
  ]);

  // Insert standard priorities for project tasks
  await knex('standard_priorities').insert([
    {
      priority_name: 'Low',
      priority_level: 70,
      color: '#9CA3AF',
      item_type: 'project_task'
    },
    {
      priority_name: 'Medium',
      priority_level: 50,
      color: '#F59E0B',
      item_type: 'project_task'
    },
    {
      priority_name: 'High',
      priority_level: 30,
      color: '#EF4444',
      item_type: 'project_task'
    },
    {
      priority_name: 'Critical',
      priority_level: 5,
      color: '#7C3AED',
      item_type: 'project_task'
    }
  ]);
};

exports.down = async function(knex) {
  await knex('standard_priorities').del();
};