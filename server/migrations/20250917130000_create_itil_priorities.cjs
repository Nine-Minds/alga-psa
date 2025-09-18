/**
 * Migration to add ITIL priorities to standard_priorities table
 * ITIL priorities are calculated from Impact × Urgency and are predefined
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const itilPriorities = [
    {
      priority_name: 'Critical',
      color: '#EF4444',
      order_number: 1,
      is_itil_standard: true,
      itil_priority_level: 1,
      item_type: 'ticket'
    },
    {
      priority_name: 'High',
      color: '#F97316',
      order_number: 2,
      is_itil_standard: true,
      itil_priority_level: 2,
      item_type: 'ticket'
    },
    {
      priority_name: 'Medium',
      color: '#EAB308',
      order_number: 3,
      is_itil_standard: true,
      itil_priority_level: 3,
      item_type: 'ticket'
    },
    {
      priority_name: 'Low',
      color: '#3B82F6',
      order_number: 4,
      is_itil_standard: true,
      itil_priority_level: 4,
      item_type: 'ticket'
    },
    {
      priority_name: 'Planning',
      color: '#6B7280',
      order_number: 5,
      is_itil_standard: true,
      itil_priority_level: 5,
      item_type: 'ticket'
    }
  ];

  // Insert each priority, but update if it already exists
  for (const priority of itilPriorities) {
    const existing = await knex('standard_priorities')
      .where('priority_name', priority.priority_name)
      .where('item_type', priority.item_type)
      .first();

    if (existing) {
      // Update existing priority to mark it as ITIL standard
      await knex('standard_priorities')
        .where('priority_id', existing.priority_id)
        .update({
          is_itil_standard: true,
          itil_priority_level: priority.itil_priority_level,
          color: priority.color,
          updated_at: knex.raw('NOW()')
        });
    } else {
      // Insert new priority
      await knex('standard_priorities').insert({
        priority_id: knex.raw('gen_random_uuid()'),
        priority_name: priority.priority_name,
        color: priority.color,
        order_number: priority.order_number,
        is_itil_standard: priority.is_itil_standard,
        itil_priority_level: priority.itil_priority_level,
        item_type: priority.item_type,
        created_at: knex.raw('NOW()'),
        updated_at: knex.raw('NOW()')
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex('standard_priorities')
    .where('is_itil_standard', true)
    .del();
};