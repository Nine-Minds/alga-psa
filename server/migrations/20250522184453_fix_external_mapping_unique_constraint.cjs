exports.up = async function(knex) {
  // Drop the existing incorrect unique constraint
  // This constraint prevents multiple Alga services from mapping to the same QuickBooks product
  await knex.raw('DROP INDEX IF EXISTS idx_unique_external_mapping;');
  
  // Create the correct unique constraint that ensures each Alga entity can only be mapped once
  // but allows multiple Alga entities to map to the same external entity
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_alga_entity_mapping 
    ON tenant_external_entity_mappings (tenant, integration_type, alga_entity_type, alga_entity_id, COALESCE(external_realm_id, ''));
  `);
};

exports.down = async function(knex) {
  // Drop the new constraint
  await knex.raw('DROP INDEX IF EXISTS idx_unique_alga_entity_mapping;');
  
  // Recreate the old (incorrect) constraint for rollback
  await knex.raw(`
    CREATE UNIQUE INDEX idx_unique_external_mapping 
    ON tenant_external_entity_mappings (tenant, integration_type, external_entity_id, COALESCE(external_realm_id, ''));
  `);
};