/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('comments', table => {
    // Add new columns
    table.enu('author_type', ['user', 'contact', 'unknown'], {
      useNative: true,
      enumName: 'comment_author_type'
    }).notNullable().defaultTo('unknown');
    table.uuid('contact_id').nullable();
  });


  await knex.schema.alterTable('comments', table => {
    table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
  });

  // Update existing records to set author_type to 'user' where user_id exists
  await knex('comments').update({
    author_type: 'user'
  }).whereNotNull('user_id');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove the new columns and constraints
  await knex.schema.alterTable('comments', table => {
    table.dropColumn('contact_id');
    table.dropColumn('author_type');
  });

  // Drop the enum type
  await knex.raw('DROP TYPE IF EXISTS comment_author_type');
};
