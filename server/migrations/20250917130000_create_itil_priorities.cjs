/**
 * Migration to create ITIL priorities as a separate system from custom priorities
 * ITIL priorities are calculated from Impact × Urgency and are predefined
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // Create ITIL priorities lookup table
    .createTable('itil_priorities', function(table) {
      table.uuid('priority_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.integer('priority_level').notNullable(); // 1-5 (Critical, High, Medium, Low, Planning)
      table.string('priority_name').notNullable();
      table.string('color').notNullable();
      table.text('description');
      table.integer('target_resolution_hours'); // SLA target hours

      // Add unique constraint on priority level
      table.unique(['priority_level']);
    })
    // Add ITIL priority field to tickets (separate from custom priority_id)
    .alterTable('tickets', function(table) {
      table.integer('itil_priority_level').nullable().comment('ITIL calculated priority (1-5)');
      table.index(['itil_priority_level']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .alterTable('tickets', function(table) {
      table.dropIndex(['itil_priority_level']);
      table.dropColumn('itil_priority_level');
    })
    .dropTableIfExists('itil_priorities');
};