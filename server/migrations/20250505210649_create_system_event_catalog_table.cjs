'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create the system_event_catalog table if it doesn't exist
  const tableExists = await knex.schema.hasTable('system_event_catalog');
  if (!tableExists) {
    await knex.schema.createTable('system_event_catalog', (table) => {
      table.uuid('event_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('event_type', 255).notNullable().unique();
      table.string('name', 255).notNullable();
      table.text('description');
      table.string('category', 100);
      table.jsonb('payload_schema'); // Store JSON schema for payload validation
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    // Add indexes
    await knex.schema.alterTable('system_event_catalog', (table) => {
      table.index('event_type');
      table.index('category');
    });

    // Add trigger for updated_at
    await knex.raw(`
      CREATE OR REPLACE FUNCTION trigger_set_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER set_timestamp
      BEFORE UPDATE ON system_event_catalog
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_timestamp();
    `);

    // Insert initial core system events
    const initialSystemEvents = [
    {
      event_type: 'COMPANY_CREATED',
      name: 'Company Created',
      description: 'Triggered when a new company record is created in the system.',
      category: 'Company Management',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          companyId: { type: 'string', format: 'uuid', description: 'The ID of the newly created company.' },
          companyName: { type: 'string', description: 'The name of the newly created company.' },
          createdByUserId: { type: 'string', format: 'uuid', description: 'The ID of the user who created the company.' }
        },
        required: ['companyId', 'companyName', 'createdByUserId']
      })
    },
    {
      event_type: 'COMPANY_UPDATED',
      name: 'Company Updated',
      description: 'Triggered when an existing company record is updated.',
      category: 'Company Management',
      payload_schema: JSON.stringify({
        type: 'object',
        properties: {
          companyId: { type: 'string', format: 'uuid', description: 'The ID of the updated company.' },
          updatedFields: { type: 'array', items: { type: 'string' }, description: 'List of fields that were updated.' },
          updatedByUserId: { type: 'string', format: 'uuid', description: 'The ID of the user who updated the company.' }
        },
        required: ['companyId', 'updatedFields', 'updatedByUserId']
      })
    }
  ];

    await knex('system_event_catalog').insert(initialSystemEvents);
    
    console.log('✅ Created system_event_catalog table and inserted initial events');
  } else {
    console.log('✅ system_event_catalog table already exists, skipping creation');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop the trigger function first if it exists
  await knex.raw('DROP TRIGGER IF EXISTS set_timestamp ON system_event_catalog;');
  await knex.raw('DROP FUNCTION IF EXISTS trigger_set_timestamp();');
  // Drop the table
  await knex.schema.dropTableIfExists('system_event_catalog');
};
