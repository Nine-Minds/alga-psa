exports.up = async function(knex) {
  // Drop the existing unique constraint
  await knex.raw(`
    ALTER TABLE document_associations 
    DROP CONSTRAINT IF EXISTS document_associations_tenant_document_id_entity_id_entity_type_unique
  `);
  
  // Drop any existing check constraint on entity_type
  await knex.raw(`
    ALTER TABLE document_associations 
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check
  `);
  
  // Add new check constraint that includes project_task
  await knex.raw(`
    ALTER TABLE document_associations 
    ADD CONSTRAINT document_associations_entity_type_check 
    CHECK (entity_type IN ('user', 'ticket', 'company', 'contact', 'asset', 'project_task'))
  `);
  
  // Recreate the unique constraint
  await knex.raw(`
    ALTER TABLE document_associations 
    ADD CONSTRAINT document_associations_tenant_document_id_entity_id_entity_type_unique 
    UNIQUE (tenant, document_id, entity_id, entity_type)
  `);
};

exports.down = async function(knex) {
  // Drop the unique constraint
  await knex.raw(`
    ALTER TABLE document_associations 
    DROP CONSTRAINT IF EXISTS document_associations_tenant_document_id_entity_id_entity_type_unique
  `);
  
  // Drop the check constraint
  await knex.raw(`
    ALTER TABLE document_associations 
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check
  `);
  
  // Add back the original check constraint without project_task
  await knex.raw(`
    ALTER TABLE document_associations 
    ADD CONSTRAINT document_associations_entity_type_check 
    CHECK (entity_type IN ('user', 'ticket', 'company', 'contact', 'asset'))
  `);
  
  // Recreate the unique constraint
  await knex.raw(`
    ALTER TABLE document_associations 
    ADD CONSTRAINT document_associations_tenant_document_id_entity_id_entity_type_unique 
    UNIQUE (tenant, document_id, entity_id, entity_type)
  `);
};