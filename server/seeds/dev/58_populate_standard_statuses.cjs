/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  // standard_statuses is a global reference catalog; the
  // make_standard_statuses_global migration populates it, so this seed only
  // backfills if rows are missing.
  await knex('standard_statuses')
    .insert([
      // Project statuses
      { name: 'Planned', item_type: 'project', display_order: 1 },
      { name: 'In Progress', item_type: 'project', display_order: 2 },
      { name: 'On Hold', item_type: 'project', display_order: 3 },
      { name: 'Completed', item_type: 'project', display_order: 4, is_closed: true },
      { name: 'Cancelled', item_type: 'project', display_order: 5, is_closed: true },

      // Project task statuses (colors and icons are in the statuses table, not standard_statuses)
      { name: 'To Do', item_type: 'project_task', display_order: 1 },
      { name: 'In Progress', item_type: 'project_task', display_order: 2 },
      { name: 'In Review', item_type: 'project_task', display_order: 3 },
      { name: 'Done', item_type: 'project_task', display_order: 4, is_closed: true },
      { name: 'Blocked', item_type: 'project_task', display_order: 5 },

      // Ticket statuses
      { name: 'Open', item_type: 'ticket', display_order: 1, is_default: true },
      { name: 'In Progress', item_type: 'ticket', display_order: 2 },
      { name: 'Waiting for Customer', item_type: 'ticket', display_order: 3 },
      { name: 'Resolved', item_type: 'ticket', display_order: 4, is_closed: true },
      { name: 'Closed', item_type: 'ticket', display_order: 5, is_closed: true },

      // Interaction statuses
      { name: 'Planned', item_type: 'interaction', display_order: 1 },
      { name: 'In Progress', item_type: 'interaction', display_order: 2 },
      { name: 'Completed', item_type: 'interaction', display_order: 3, is_closed: true, is_default: true },
      { name: 'Cancelled', item_type: 'interaction', display_order: 4, is_closed: true }
    ])
    .onConflict(['name', 'item_type'])
    .ignore();
};
