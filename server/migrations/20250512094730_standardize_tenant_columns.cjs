exports.up = async function(knex) {
  // 1. Rename 'tenant_id' columns to 'tenant'
  
  // event_catalog
  await knex.raw(`
    ALTER TABLE event_catalog RENAME COLUMN tenant_id TO tenant;
  `);
  
  // service_types
  await knex.raw(`
    ALTER TABLE service_types RENAME COLUMN tenant_id TO tenant;
  `);
  
  // tenant_companies
  await knex.raw(`
    ALTER TABLE tenant_companies RENAME COLUMN tenant_id TO tenant;
  `);
  
  // tenant_external_entity_mappings
  await knex.raw(`
    ALTER TABLE tenant_external_entity_mappings RENAME COLUMN tenant_id TO tenant;
  `);
  
  // time_period_settings
  await knex.raw(`
    ALTER TABLE time_period_settings RENAME COLUMN tenant_id TO tenant;
  `);
  
  // workflow_event_attachments
  await knex.raw(`
    ALTER TABLE workflow_event_attachments RENAME COLUMN tenant_id TO tenant;
  `);
  
  // workflow_registration_versions
  await knex.raw(`
    ALTER TABLE workflow_registration_versions RENAME COLUMN tenant_id TO tenant;
  `);
  
  // workflow_registrations
  await knex.raw(`
    ALTER TABLE workflow_registrations RENAME COLUMN tenant_id TO tenant;
  `);
  
  // workflow_template_categories
  await knex.raw(`
    ALTER TABLE workflow_template_categories RENAME COLUMN tenant_id TO tenant;
  `);
  
  // workflow_templates
  await knex.raw(`
    ALTER TABLE workflow_templates RENAME COLUMN tenant_id TO tenant;
  `);
  
  // workflow_triggers
  await knex.raw(`
    ALTER TABLE workflow_triggers RENAME COLUMN tenant_id TO tenant;
  `);

  // 2. Change the data type of non-UUID tenant columns to UUID
  
  // api_keys (varchar to uuid) - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON api_keys;
  `);
  
  await knex.raw(`
    ALTER TABLE api_keys ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON api_keys
    FOR ALL
    TO public
    USING (tenant = current_setting('app.current_tenant')::uuid);
  `);
  
  // audit_logs (varchar to uuid) - Need to drop and recreate policies
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON audit_logs;
    DROP POLICY IF EXISTS tenant_isolation_policy_insert ON audit_logs;
  `);
  
  await knex.raw(`
    ALTER TABLE audit_logs ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON audit_logs
    FOR ALL
    TO public
    USING (tenant = current_setting('app.current_tenant')::uuid);
    
    CREATE POLICY tenant_isolation_policy_insert ON audit_logs
    FOR INSERT
    TO public
    WITH CHECK (true);
  `);
  
  // invoice_time_entries (varchar to uuid)
  await knex.raw(`
    ALTER TABLE invoice_time_entries ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // invoice_usage_records (varchar to uuid)
  await knex.raw(`
    ALTER TABLE invoice_usage_records ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // Workflow tables - Need to drop foreign key constraints before changing types
  
  // workflow_action_dependencies - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_tenant_execution_id_foreign;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_action_id_foreign;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_depends_on_id_foreign;
  `);
  
  // workflow_action_results - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_action_results DROP CONSTRAINT IF EXISTS workflow_action_results_tenant_execution_id_foreign;
  `);
  
  // workflow_events - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_events DROP CONSTRAINT IF EXISTS workflow_events_tenant_execution_id_foreign;
  `);
  
  // workflow_snapshots - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_snapshots DROP CONSTRAINT IF EXISTS workflow_snapshots_execution_id_foreign;
  `);
  
  // workflow_sync_points - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_sync_points DROP CONSTRAINT IF EXISTS workflow_sync_points_tenant_execution_id_foreign;
  `);
  
  // workflow_timers - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_timers DROP CONSTRAINT IF EXISTS workflow_timers_tenant_execution_id_foreign;
  `);
  
  // workflow_event_processing - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_event_processing DROP CONSTRAINT IF EXISTS workflow_event_processing_execution_id_foreign;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_event_processing DROP CONSTRAINT IF EXISTS workflow_event_processing_event_id_foreign;
  `);
  
  // workflow_form_schemas - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_form_schemas DROP CONSTRAINT IF EXISTS workflow_form_schemas_form_id_foreign;
  `);
  
  // Now change the column types
  
  // workflow_executions (text to uuid) - Change this first since other tables reference it
  await knex.raw(`
    ALTER TABLE workflow_executions ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_action_results (text to uuid)
  await knex.raw(`
    ALTER TABLE workflow_action_results ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_action_dependencies (text to uuid)
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_events (text to uuid)
  await knex.raw(`
    ALTER TABLE workflow_events ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_event_processing (varchar to uuid)
  await knex.raw(`
    ALTER TABLE workflow_event_processing ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_form_definitions (varchar to uuid)
  await knex.raw(`
    ALTER TABLE workflow_form_definitions ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_form_schemas (varchar to uuid)
  await knex.raw(`
    ALTER TABLE workflow_form_schemas ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_snapshots (varchar to uuid)
  await knex.raw(`
    ALTER TABLE workflow_snapshots ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_sync_points (text to uuid)
  await knex.raw(`
    ALTER TABLE workflow_sync_points ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_task_definitions (text to uuid)
  await knex.raw(`
    ALTER TABLE workflow_task_definitions ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_task_history (text to uuid)
  await knex.raw(`
    ALTER TABLE workflow_task_history ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_tasks (text to uuid)
  await knex.raw(`
    ALTER TABLE workflow_tasks ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_timers (text to uuid)
  await knex.raw(`
    ALTER TABLE workflow_timers ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  // workflow_template_categories (text to uuid) - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON workflow_template_categories;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_template_categories ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON workflow_template_categories
    FOR ALL
    TO public
    USING (tenant = current_setting('app.current_tenant')::uuid);
  `);
  
  // workflow_templates (text to uuid) - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON workflow_templates;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_templates ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON workflow_templates
    FOR ALL
    TO public
    USING (tenant = current_setting('app.current_tenant')::uuid);
  `);
  
  // workflow_registration_versions (text to uuid) - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON workflow_registration_versions;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_registration_versions ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON workflow_registration_versions
    FOR ALL
    TO public
    USING (tenant = current_setting('app.current_tenant')::uuid);
  `);
  
  // workflow_registrations (text to uuid) - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON workflow_registrations;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_registrations ALTER COLUMN tenant TYPE uuid USING tenant::uuid;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON workflow_registrations
    FOR ALL
    TO public
    USING (tenant = current_setting('app.current_tenant')::uuid);
  `);
  
  // Now recreate the foreign key constraints with the updated UUID type
  
  // workflow_action_results - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_action_results ADD CONSTRAINT workflow_action_results_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);
  
  // workflow_action_dependencies - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_action_id_foreign 
    FOREIGN KEY (action_id) REFERENCES workflow_action_results(result_id);
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_depends_on_id_foreign 
    FOREIGN KEY (depends_on_id) REFERENCES workflow_action_results(result_id);
  `);
  
  // workflow_events - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_events ADD CONSTRAINT workflow_events_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);
  
  // workflow_snapshots - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_snapshots ADD CONSTRAINT workflow_snapshots_execution_id_foreign 
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(execution_id);
  `);
  
  // workflow_sync_points - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_sync_points ADD CONSTRAINT workflow_sync_points_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);
  
  // workflow_timers - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_timers ADD CONSTRAINT workflow_timers_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);
  
  // workflow_event_processing - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_event_processing ADD CONSTRAINT workflow_event_processing_execution_id_foreign 
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(execution_id);
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_event_processing ADD CONSTRAINT workflow_event_processing_event_id_foreign 
    FOREIGN KEY (event_id) REFERENCES workflow_events(event_id);
  `);
  
  // workflow_form_schemas - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_form_schemas ADD CONSTRAINT workflow_form_schemas_form_id_foreign 
    FOREIGN KEY (form_id) REFERENCES workflow_form_definitions(form_id);
  `);
};

exports.down = async function(knex) {
  // 1. Drop foreign key constraints before reverting data types
  
  // workflow_form_schemas - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_form_schemas DROP CONSTRAINT IF EXISTS workflow_form_schemas_form_id_foreign;
  `);
  
  // workflow_event_processing - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_event_processing DROP CONSTRAINT IF EXISTS workflow_event_processing_event_id_foreign;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_event_processing DROP CONSTRAINT IF EXISTS workflow_event_processing_execution_id_foreign;
  `);
  
  // workflow_snapshots - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_snapshots DROP CONSTRAINT IF EXISTS workflow_snapshots_execution_id_foreign;
  `);
  
  // workflow_sync_points - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_sync_points DROP CONSTRAINT IF EXISTS workflow_sync_points_tenant_execution_id_foreign;
  `);
  
  // workflow_timers - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_timers DROP CONSTRAINT IF EXISTS workflow_timers_tenant_execution_id_foreign;
  `);
  
  // workflow_events - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_events DROP CONSTRAINT IF EXISTS workflow_events_tenant_execution_id_foreign;
  `);
  
  // workflow_action_dependencies - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_depends_on_id_foreign;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_action_id_foreign;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_tenant_execution_id_foreign;
  `);
  
  // workflow_action_results - Drop constraints
  await knex.raw(`
    ALTER TABLE workflow_action_results DROP CONSTRAINT IF EXISTS workflow_action_results_tenant_execution_id_foreign;
  `);
  
  // 2. Revert data type changes (UUID back to original types)
  
  // api_keys (uuid to varchar) - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON api_keys;
  `);
  
  await knex.raw(`
    ALTER TABLE api_keys ALTER COLUMN tenant TYPE character varying;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON api_keys
    FOR ALL
    TO public
    USING ((tenant)::text = current_setting('app.current_tenant'::text));
  `);
  
  // audit_logs (uuid to varchar) - Need to drop and recreate policies
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON audit_logs;
    DROP POLICY IF EXISTS tenant_isolation_policy_insert ON audit_logs;
  `);
  
  await knex.raw(`
    ALTER TABLE audit_logs ALTER COLUMN tenant TYPE character varying;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON audit_logs
    FOR ALL
    TO public
    USING ((tenant)::text = current_setting('app.current_tenant'::text));
    
    CREATE POLICY tenant_isolation_policy_insert ON audit_logs
    FOR INSERT
    TO public
    WITH CHECK (true);
  `);
  
  // workflow_timers (uuid to text)
  await knex.raw(`
    ALTER TABLE workflow_timers ALTER COLUMN tenant TYPE text;
  `);
  
  // workflow_tasks (uuid to text)
  await knex.raw(`
    ALTER TABLE workflow_tasks ALTER COLUMN tenant TYPE text;
  `);
  
  // workflow_task_history (uuid to text)
  await knex.raw(`
    ALTER TABLE workflow_task_history ALTER COLUMN tenant TYPE text;
  `);
  
  // workflow_task_definitions (uuid to text)
  await knex.raw(`
    ALTER TABLE workflow_task_definitions ALTER COLUMN tenant TYPE text;
  `);
  
  // workflow_sync_points (uuid to text)
  await knex.raw(`
    ALTER TABLE workflow_sync_points ALTER COLUMN tenant TYPE text;
  `);
  
  // workflow_snapshots (uuid to varchar)
  await knex.raw(`
    ALTER TABLE workflow_snapshots ALTER COLUMN tenant TYPE character varying;
  `);
  
  // workflow_form_schemas (uuid to varchar)
  await knex.raw(`
    ALTER TABLE workflow_form_schemas ALTER COLUMN tenant TYPE character varying;
  `);
  
  // workflow_form_definitions (uuid to varchar)
  await knex.raw(`
    ALTER TABLE workflow_form_definitions ALTER COLUMN tenant TYPE character varying;
  `);
  
  // workflow_executions (uuid to text)
  await knex.raw(`
    ALTER TABLE workflow_executions ALTER COLUMN tenant TYPE text;
  `);
  
  // workflow_events (uuid to text)
  await knex.raw(`
    ALTER TABLE workflow_events ALTER COLUMN tenant TYPE text;
  `);
  
  // workflow_event_processing (uuid to varchar)
  await knex.raw(`
    ALTER TABLE workflow_event_processing ALTER COLUMN tenant TYPE character varying;
  `);
  
  // workflow_action_results (uuid to text)
  await knex.raw(`
    ALTER TABLE workflow_action_results ALTER COLUMN tenant TYPE text;
  `);
  
  // workflow_action_dependencies (uuid to text)
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ALTER COLUMN tenant TYPE text;
  `);
  
  // invoice_usage_records (uuid to varchar)
  await knex.raw(`
    ALTER TABLE invoice_usage_records ALTER COLUMN tenant TYPE character varying;
  `);
  
  // invoice_time_entries (uuid to varchar)
  await knex.raw(`
    ALTER TABLE invoice_time_entries ALTER COLUMN tenant TYPE character varying;
  `);
  
  // 3. Recreate foreign key constraints with original types
  
  // workflow_action_results - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_action_results ADD CONSTRAINT workflow_action_results_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);
  
  // workflow_action_dependencies - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_action_id_foreign 
    FOREIGN KEY (action_id) REFERENCES workflow_action_results(result_id);
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_depends_on_id_foreign 
    FOREIGN KEY (depends_on_id) REFERENCES workflow_action_results(result_id);
  `);
  
  // workflow_events - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_events ADD CONSTRAINT workflow_events_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);
  
  // workflow_snapshots - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_snapshots ADD CONSTRAINT workflow_snapshots_execution_id_foreign 
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(execution_id);
  `);
  
  // workflow_timers - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_timers ADD CONSTRAINT workflow_timers_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);
  
  // workflow_event_processing - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_event_processing ADD CONSTRAINT workflow_event_processing_execution_id_foreign 
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(execution_id);
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_event_processing ADD CONSTRAINT workflow_event_processing_event_id_foreign 
    FOREIGN KEY (event_id) REFERENCES workflow_events(event_id);
  `);
  
  // workflow_form_schemas - Recreate constraints
  await knex.raw(`
    ALTER TABLE workflow_form_schemas ADD CONSTRAINT workflow_form_schemas_form_id_foreign 
    FOREIGN KEY (form_id) REFERENCES workflow_form_definitions(form_id);
  `);

  // 4. Revert column name changes ('tenant' back to 'tenant_id')
  
  // workflow_triggers
  await knex.raw(`
    ALTER TABLE workflow_triggers RENAME COLUMN tenant TO tenant_id;
  `);
  
  // workflow_templates
  await knex.raw(`
    ALTER TABLE workflow_templates RENAME COLUMN tenant TO tenant_id;
  `);
  
  // workflow_template_categories - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON workflow_template_categories;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_template_categories RENAME COLUMN tenant TO tenant_id;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON workflow_template_categories
    FOR ALL
    TO public
    USING ((tenant_id)::text = current_setting('app.current_tenant'::text));
  `);
  
  // workflow_templates - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON workflow_templates;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_templates RENAME COLUMN tenant TO tenant_id;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON workflow_templates
    FOR ALL
    TO public
    USING ((tenant_id)::text = current_setting('app.current_tenant'::text));
  `);
  
  // workflow_registration_versions - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON workflow_registration_versions;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_registration_versions RENAME COLUMN tenant TO tenant_id;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON workflow_registration_versions
    FOR ALL
    TO public
    USING ((tenant_id)::text = current_setting('app.current_tenant'::text));
  `);
  
  // workflow_registrations - Need to drop and recreate policy
  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_policy ON workflow_registrations;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_registrations RENAME COLUMN tenant TO tenant_id;
  `);
  
  await knex.raw(`
    CREATE POLICY tenant_isolation_policy ON workflow_registrations
    FOR ALL
    TO public
    USING ((tenant_id)::text = current_setting('app.current_tenant'::text));
  `);
  
  // time_period_settings
  await knex.raw(`
    ALTER TABLE time_period_settings RENAME COLUMN tenant TO tenant_id;
  `);
  
  // tenant_external_entity_mappings
  await knex.raw(`
    ALTER TABLE tenant_external_entity_mappings RENAME COLUMN tenant TO tenant_id;
  `);
  
  // tenant_companies
  await knex.raw(`
    ALTER TABLE tenant_companies RENAME COLUMN tenant TO tenant_id;
  `);
  
  // service_types
  await knex.raw(`
    ALTER TABLE service_types RENAME COLUMN tenant TO tenant_id;
  `);
  
  // event_catalog
  await knex.raw(`
    ALTER TABLE event_catalog RENAME COLUMN tenant TO tenant_id;
  `);
};
