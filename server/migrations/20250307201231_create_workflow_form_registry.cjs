/**
 * Migration to create workflow form registry tables
 */
exports.up = async function(knex) {
  // Create workflow_form_definitions table
  await knex.schema.createTable('workflow_form_definitions', (table) => {
    table.string('form_id').primary();
    table.string('tenant').notNullable();
    table.string('name').notNullable();
    table.text('description');
    table.string('version', 50).notNullable();
    table.string('status', 50).notNullable().defaultTo('active');
    table.string('category', 100);
    table.string('created_by');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Add unique constraint for tenant, form_id, and version
    table.unique(['tenant', 'form_id', 'version']);
  });

  // Create workflow_form_schemas table
  await knex.schema.createTable('workflow_form_schemas', (table) => {
    table.string('schema_id').primary();
    table.string('form_id').notNullable();
    table.string('tenant').notNullable();
    table.jsonb('json_schema').notNullable();
    table.jsonb('ui_schema');
    table.jsonb('default_values');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Add foreign key constraint
    table.foreign('form_id').references('form_id').inTable('workflow_form_definitions').onDelete('CASCADE');
    
    // Add unique constraint for tenant and form_id
    table.unique(['tenant', 'form_id']);
  });

  // Add workflow_form to the list of tagged entity types if needed
  // This is handled in the code by updating the TaggedEntityType type
};

exports.down = async function(knex) {
  // Drop tables in reverse order to handle foreign key constraints
  await knex.schema.dropTableIfExists('workflow_form_schemas');
  await knex.schema.dropTableIfExists('workflow_form_definitions');
};