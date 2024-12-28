/**
 * Adds originalEntryId column to schedule_entries table to support recurrence handling.
 * This column links recurring instances to their master entry.
 */
exports.up = async function(knex) {
  // First add unique constraint to entry_id
  await knex.schema.alterTable('schedule_entries', table => {
    table.unique(['entry_id', 'tenant']);
  });

  // Then add the new columns
  return knex.schema.alterTable('schedule_entries', table => {
    // Add original_entry_id column
    table.uuid('original_entry_id');

    // Add foreign key constraint referencing both entry_id and tenant
    table.foreign(['original_entry_id', 'tenant'])
      .references(['entry_id', 'tenant'])
      .inTable('schedule_entries')
      .onDelete('CASCADE');

    // Add is_recurring flag
    table.boolean('is_recurring')
      .defaultTo(false);
  });
};

exports.down = async function(knex) {
  // First drop the columns
  await knex.schema.alterTable('schedule_entries', table => {
    table.dropColumn('original_entry_id');
    table.dropColumn('is_recurring');
  });

  // Then drop the unique constraint
  return knex.schema.alterTable('schedule_entries', table => {
    table.dropUnique(['entry_id', 'tenant']);
  });
};
