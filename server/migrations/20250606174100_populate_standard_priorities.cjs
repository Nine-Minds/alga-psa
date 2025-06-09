exports.up = async function(knex) {
  // Insert standard priorities for tickets
  await knex('standard_priorities').insert([
    {
      priority_name: 'Low',
      priority_level: 70,
      color: '#10B981', // Green
      item_type: 'ticket'
    },
    {
      priority_name: 'Medium',
      priority_level: 50,
      color: '#F59E0B', // Yellow
      item_type: 'ticket'
    },
    {
      priority_name: 'High',
      priority_level: 30,
      color: '#EC4899', // Pink
      item_type: 'ticket'
    },
    {
      priority_name: 'Urgent',
      priority_level: 10,
      color: '#EF4444', // Red
      item_type: 'ticket'
    }
  ]);

  // Insert standard priorities for project tasks
  await knex('standard_priorities').insert([
    {
      priority_name: 'Low',
      priority_level: 70,
      color: '#10B981', // Green
      item_type: 'project_task'
    },
    {
      priority_name: 'Medium',
      priority_level: 50,
      color: '#F59E0B', // Yellow
      item_type: 'project_task'
    },
    {
      priority_name: 'High',
      priority_level: 30,
      color: '#EC4899', // Pink
      item_type: 'project_task'
    },
    {
      priority_name: 'Critical',
      priority_level: 5,
      color: '#EF4444', // Red
      item_type: 'project_task'
    }
  ]);
};

exports.down = async function(knex) {
  await knex('standard_priorities').del();
};