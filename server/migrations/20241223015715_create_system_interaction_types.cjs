/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create system_interaction_types table
  await knex.schema.createTable('system_interaction_types', (table) => {
    table.uuid('type_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('type_name').notNullable().unique();
    table.text('icon');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // Insert standard interaction types
  await knex('system_interaction_types').insert([
    { type_name: 'Call', icon: 'phone' },
    { type_name: 'Email', icon: 'mail' },
    { type_name: 'Meeting', icon: 'users' },
    { type_name: 'Note', icon: 'file-text' }
  ]);

  // Add system_type_id to interaction_types table
  await knex.schema.alterTable('interaction_types', (table) => {
    table.uuid('system_type_id').references('type_id').inTable('system_interaction_types').onDelete('SET NULL');
  });

  // Create a trigger to prevent updates/deletes on system_interaction_types
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_system_interaction_type_modification()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Modification of system interaction types is not allowed';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER prevent_system_interaction_type_modification
    BEFORE UPDATE OR DELETE ON system_interaction_types
    FOR EACH ROW
    EXECUTE FUNCTION prevent_system_interaction_type_modification();
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove trigger and function
  await knex.raw(`
    DROP TRIGGER IF EXISTS prevent_system_interaction_type_modification ON system_interaction_types;
    DROP FUNCTION IF EXISTS prevent_system_interaction_type_modification();
  `);

  // Remove system_type_id from interaction_types
  await knex.schema.alterTable('interaction_types', (table) => {
    table.dropColumn('system_type_id');
  });

  // Drop system_interaction_types table
  await knex.schema.dropTableIfExists('system_interaction_types');
};
