// Helper function for updated_at trigger (common pattern)
const ON_UPDATE_TIMESTAMP_FUNCTION = `
  CREATE OR REPLACE FUNCTION on_update_timestamp()
  RETURNS trigger AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
$$ language 'plpgsql';
`;

const DROP_ON_UPDATE_TIMESTAMP_FUNCTION = `DROP FUNCTION IF EXISTS on_update_timestamp() CASCADE;`;

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create the trigger function
  await knex.raw(ON_UPDATE_TIMESTAMP_FUNCTION);

  // Create the table
  await knex.schema.createTable('tenant_external_entity_mappings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE').index(); // FK and index
    table.string('integration_type', 50).notNullable();
    table.string('alga_entity_type', 50).notNullable();
    table.string('alga_entity_id', 255).notNullable();
    table.string('external_entity_id', 255).notNullable();
    table.string('external_realm_id', 255).nullable();
    table.string('sync_status', 20).nullable().defaultTo('pending');
    table.timestamp('last_synced_at', { useTz: true }).nullable();
    table.jsonb('metadata').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Unique Constraint 1: (tenant_id, integration_type, alga_entity_type, alga_entity_id)
    table.unique(['tenant_id', 'integration_type', 'alga_entity_type', 'alga_entity_id'], { indexName: 'idx_unique_alga_mapping' });

    // Additional Indexes
    table.index(['tenant_id', 'integration_type'], 'idx_tenant_integration');
    table.index(['tenant_id', 'integration_type', 'external_entity_id'], 'idx_tenant_integration_external');
    // Index supporting unique constraint 1 is created automatically by table.unique

  });

  // Unique Constraint 2: (tenant_id, integration_type, external_entity_id, COALESCE(external_realm_id, ''))
  // Use knex.raw because Knex's unique constraint doesn't directly support COALESCE
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_external_mapping
    ON tenant_external_entity_mappings (tenant_id, integration_type, external_entity_id, COALESCE(external_realm_id, ''));
  `);

  // Apply the updated_at trigger
  await knex.raw(`
    CREATE TRIGGER set_timestamp
    BEFORE UPDATE ON tenant_external_entity_mappings
    FOR EACH ROW
    EXECUTE PROCEDURE on_update_timestamp();
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('tenant_external_entity_mappings');
  // Drop the trigger function if it exists
  await knex.raw(DROP_ON_UPDATE_TIMESTAMP_FUNCTION);
};