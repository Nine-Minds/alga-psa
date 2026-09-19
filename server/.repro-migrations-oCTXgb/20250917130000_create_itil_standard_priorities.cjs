/**
 * Migration to populate ITIL standard priorities in standard_priorities table
 * ITIL priorities are calculated from Impact × Urgency matrix
 * This migration adds the standard ITIL priorities to the reference table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // ITIL standard priority definitions
  // Using order numbers 100-104 to separate from custom priorities (1-4)
  const itilPriorities = [
    {
      priority_name: 'P1 - Critical',
      color: '#DC2626', // Red
      order_number: 100,
      is_itil_standard: true,
      itil_priority_level: 1,
      item_type: 'ticket'
    },
    {
      priority_name: 'P2 - High',
      color: '#EA580C', // Orange
      order_number: 101,
      is_itil_standard: true,
      itil_priority_level: 2,
      item_type: 'ticket'
    },
    {
      priority_name: 'P3 - Medium',
      color: '#F59E0B', // Amber
      order_number: 102,
      is_itil_standard: true,
      itil_priority_level: 3,
      item_type: 'ticket'
    },
    {
      priority_name: 'P4 - Low',
      color: '#3B82F6', // Blue
      order_number: 103,
      is_itil_standard: true,
      itil_priority_level: 4,
      item_type: 'ticket'
    },
    {
      priority_name: 'P5 - Planning',
      color: '#6B7280', // Gray
      order_number: 104,
      is_itil_standard: true,
      itil_priority_level: 5,
      item_type: 'ticket'
    }
  ];

  // Insert each priority
  for (const priority of itilPriorities) {
    // Check if already exists (by name and item_type)
    const existing = await knex('standard_priorities')
      .where('priority_name', priority.priority_name)
      .where('item_type', priority.item_type)
      .first();

    if (existing) {
      // Update existing to mark as ITIL standard
      await knex('standard_priorities')
        .where('priority_id', existing.priority_id)
        .update({
          is_itil_standard: true,
          itil_priority_level: priority.itil_priority_level,
          color: priority.color,
          order_number: priority.order_number,
          updated_at: knex.fn.now()
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
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }

  // Also ensure we have standard custom priorities for comparison
  // Using order numbers 1-4 for custom priorities
  const customPriorities = [
    {
      priority_name: 'Critical',
      color: '#EF4444',
      order_number: 1,
      is_itil_standard: false,
      item_type: 'ticket'
    },
    {
      priority_name: 'High',
      color: '#F97316',
      order_number: 2,
      is_itil_standard: false,
      item_type: 'ticket'
    },
    {
      priority_name: 'Medium',
      color: '#EAB308',
      order_number: 3,
      is_itil_standard: false,
      item_type: 'ticket'
    },
    {
      priority_name: 'Low',
      color: '#3B82F6',
      order_number: 4,
      is_itil_standard: false,
      item_type: 'ticket'
    }
  ];

  // Insert custom priorities if they don't exist
  for (const priority of customPriorities) {
    const existing = await knex('standard_priorities')
      .where('priority_name', priority.priority_name)
      .where('item_type', priority.item_type)
      .where('is_itil_standard', false)
      .first();

    if (!existing) {
      await knex('standard_priorities').insert({
        priority_id: knex.raw('gen_random_uuid()'),
        priority_name: priority.priority_name,
        color: priority.color,
        order_number: priority.order_number,
        is_itil_standard: priority.is_itil_standard,
        itil_priority_level: null,
        item_type: priority.item_type,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove ITIL standard priorities
  await knex('standard_priorities')
    .where('is_itil_standard', true)
    .del();

  // Reset the is_itil_standard flag on remaining priorities
  await knex('standard_priorities')
    .update({
      is_itil_standard: false,
      itil_priority_level: null
    });
};