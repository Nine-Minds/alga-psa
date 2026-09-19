/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Set 'Open' as the default status for tickets in standard_statuses only
  await knex('standard_statuses')
    .where({
      name: 'Open',
      item_type: 'ticket'
    })
    .update({
      is_default: true
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove default flag from 'Open' status for tickets in standard_statuses
  await knex('standard_statuses')
    .where({
      name: 'Open',
      item_type: 'ticket'
    })
    .update({
      is_default: false
    });
};