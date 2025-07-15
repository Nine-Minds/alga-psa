exports.up = function(knex) {
  return knex.raw(`
    -- First drop the existing unique constraint
    ALTER TABLE document_associations 
    DROP CONSTRAINT IF EXISTS document_associations_tenant_document_id_entity_id_entity_type_unique;
    
    -- Drop any existing check constraint on entity_type
    ALTER TABLE document_associations 
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check;
    
    -- Add new check constraint that includes project_task
    ALTER TABLE document_associations 
    ADD CONSTRAINT document_associations_entity_type_check 
    CHECK (entity_type IN ('user', 'ticket', 'company', 'contact', 'asset', 'project_task'));
    
    -- Recreate the unique constraint
    ALTER TABLE document_associations 
    ADD CONSTRAINT document_associations_tenant_document_id_entity_id_entity_type_unique 
    UNIQUE (tenant, document_id, entity_id, entity_type);
  `);
};

exports.down = function(knex) {
  return knex.raw(`
    -- First drop the unique constraint
    ALTER TABLE document_associations 
    DROP CONSTRAINT IF EXISTS document_associations_tenant_document_id_entity_id_entity_type_unique;
    
    -- Drop the check constraint
    ALTER TABLE document_associations 
    DROP CONSTRAINT IF EXISTS document_associations_entity_type_check;
    
    -- Add back the original check constraint without project_task
    ALTER TABLE document_associations 
    ADD CONSTRAINT document_associations_entity_type_check 
    CHECK (entity_type IN ('user', 'ticket', 'company', 'contact', 'asset'));
    
    -- Recreate the unique constraint
    ALTER TABLE document_associations 
    ADD CONSTRAINT document_associations_tenant_document_id_entity_id_entity_type_unique 
    UNIQUE (tenant, document_id, entity_id, entity_type);
  `);
};