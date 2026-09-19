exports.up = async function(knex) {
  // Insert standard priorities for tickets
  await knex('standard_priorities').insert([
    {
      priority_name: 'Urgent',
      order_number: 4,
      color: '#EF4444', // Red
      item_type: 'ticket'
    },
    {
      priority_name: 'High',
      order_number: 3,
      color: '#D37C7C', // Pink
      item_type: 'ticket'
    },
    {
      priority_name: 'Medium',
      order_number: 2,
      color: '#F59E0B', // Yellow
      item_type: 'ticket'
    },
    {
      priority_name: 'Low',
      order_number: 1,
      color: '#10B981', // Green
      item_type: 'ticket'
    }
  ]);

  // Insert standard priorities for project tasks
  await knex('standard_priorities').insert([
    {
      priority_name: 'Critical',
      order_number: 4,
      color: '#EF4444', // Red
      item_type: 'project_task'
    },
    {
      priority_name: 'High',
      order_number: 3,
      color: '#D37C7C', // Pink
      item_type: 'project_task'
    },
    {
      priority_name: 'Medium',
      order_number: 2,
      color: '#F59E0B', // Yellow
      item_type: 'project_task'
    },
    {
      priority_name: 'Low',
      order_number: 1,
      color: '#10B981', // Green
      item_type: 'project_task'
    }
  ]);
};

exports.down = async function(knex) {
  await knex('standard_priorities').del();
};