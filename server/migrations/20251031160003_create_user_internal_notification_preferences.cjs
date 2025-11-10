/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    // User internal notification preferences
    .createTable('user_internal_notification_preferences', table => {
      table.increments('preference_id').primary();
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.integer('category_id'); // null = applies to all categories
      table.integer('subtype_id'); // null = applies to entire category
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.timestamps(true, true);

      // Foreign keys
      table.foreign(['tenant', 'user_id'])
        .references(['tenant', 'user_id'])
        .inTable('users')
        .onDelete('CASCADE');

      table.foreign('category_id')
        .references('internal_notification_category_id')
        .inTable('internal_notification_categories')
        .onDelete('CASCADE');

      table.foreign('subtype_id')
        .references('internal_notification_subtype_id')
        .inTable('internal_notification_subtypes')
        .onDelete('CASCADE');

      // Unique constraint: one preference per user per category/subtype combination
      table.unique(['tenant', 'user_id', 'category_id', 'subtype_id']);
    })

    // Add index for quick lookups
    .raw(`
      CREATE INDEX idx_user_internal_notification_preferences_lookup
      ON user_internal_notification_preferences(tenant, user_id, category_id, subtype_id)
      WHERE is_enabled = true;
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop index first
  await knex.raw('DROP INDEX IF EXISTS idx_user_internal_notification_preferences_lookup');

  // Then drop the table
  return knex.schema
    .dropTableIfExists('user_internal_notification_preferences');
};
