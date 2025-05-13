/**

 * The triggers that were previously on these tables will be dropped and cannot be recreated.
 */
exports.up = async function(knex) {
  // Step 1: Drop foreign key constraints that reference the tables we're converting
  await knex.raw(`
    -- Drop FKs to system_workflow_registrations
    ALTER TABLE system_workflow_registration_versions 
    DROP CONSTRAINT IF EXISTS system_workflow_registration_versions_registration_id_foreign;
    
    ALTER TABLE system_workflow_event_attachments 
    DROP CONSTRAINT IF EXISTS system_workflow_event_attachments_workflow_id_foreign;
  `);

  // Step 2: Drop triggers on the tables we're converting
  await knex.raw(`
    -- Drop triggers on tenant_external_entity_mappings
    DROP TRIGGER IF EXISTS set_timestamp ON tenant_external_entity_mappings;
    
    -- Drop triggers on system tables
    DROP TRIGGER IF EXISTS set_system_workflow_registrations_updated_at ON system_workflow_registrations;
    DROP TRIGGER IF EXISTS set_system_workflow_registration_versions_updated_at ON system_workflow_registration_versions;
    DROP TRIGGER IF EXISTS set_system_workflow_event_attachments_updated_at ON system_workflow_event_attachments;
  `);

  // Step 3: Recreate foreign key constraints
  await knex.raw(`
    -- Recreate FKs to system_workflow_registrations
    ALTER TABLE system_workflow_registration_versions 
    ADD CONSTRAINT system_workflow_registration_versions_registration_id_foreign
    FOREIGN KEY (registration_id) REFERENCES system_workflow_registrations(registration_id) ON DELETE CASCADE;
    
    ALTER TABLE system_workflow_event_attachments 
    ADD CONSTRAINT system_workflow_event_attachments_workflow_id_foreign
    FOREIGN KEY (workflow_id) REFERENCES system_workflow_registrations(registration_id) ON DELETE CASCADE;
  `);

};

exports.down = async function(knex) {
  console.log('Warning: Converting back from Citus distributed/reference tables is not supported in this migration.');
};
