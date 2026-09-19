/**
 * Migration to create the event catalog tables
 */
exports.up = function(knex) {
  return Promise.all([
    // Create event_catalog table
    knex.schema.createTable('event_catalog', (table) => {
      table.uuid('event_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('event_type').notNullable();
      table.string('name').notNullable();
      table.text('description');
      table.string('category');
      table.jsonb('payload_schema').notNullable();
      table.boolean('is_system_event').defaultTo(false);
      table.uuid('tenant_id').notNullable();
      table.timestamps(true, true);
      
      // Add unique constraint on event_type and tenant_id
      table.unique(['event_type', 'tenant_id']);
    }),

    // Create workflow_triggers table
    knex.schema.createTable('workflow_triggers', (table) => {
      table.uuid('trigger_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant_id').notNullable();
      table.string('name').notNullable();
      table.text('description');
      table.string('event_type').notNullable();
      table.timestamps(true, true);
      
      // Add unique constraint on name and tenant_id
      table.unique(['name', 'tenant_id']);
    }),

    // Create workflow_event_mappings table
    knex.schema.createTable('workflow_event_mappings', (table) => {
      table.uuid('mapping_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('trigger_id').notNullable();
      table.string('event_field_path').notNullable();
      table.string('workflow_parameter').notNullable();
      table.text('transform_function');
      table.timestamps(true, true);
      
      // Add foreign key constraint
      table.foreign('trigger_id').references('trigger_id').inTable('workflow_triggers').onDelete('CASCADE');
    }),

    // Create workflow_event_attachments table
    knex.schema.createTable('workflow_event_attachments', (table) => {
      table.uuid('attachment_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('workflow_id').notNullable();
      table.uuid('event_id').notNullable();
      table.uuid('tenant_id').notNullable();
      table.boolean('is_active').defaultTo(true);
      table.timestamps(true, true);
      
      // Add unique constraint on workflow_id, event_id, and tenant_id
      table.unique(['workflow_id', 'event_id', 'tenant_id']);
      
      // Add foreign key constraints
      table.foreign('event_id').references('event_id').inTable('event_catalog').onDelete('CASCADE');
    })
  ]);
};

exports.down = function(knex) {
  return Promise.all([
    knex.schema.dropTableIfExists('workflow_event_attachments'),
    knex.schema.dropTableIfExists('workflow_event_mappings'),
    knex.schema.dropTableIfExists('workflow_triggers'),
    knex.schema.dropTableIfExists('event_catalog')
  ]);
};