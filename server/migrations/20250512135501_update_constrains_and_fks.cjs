exports.up = async function(knex) {
  // Company locations migration
  await knex.raw(`
    ALTER TABLE company_locations ADD COLUMN tenant uuid;
  `);

  await knex.raw(`
    UPDATE company_locations cl
    SET tenant = c.tenant
    FROM companies c
    WHERE cl.company_id = c.company_id;
  `);

  await knex.raw(`
    ALTER TABLE company_locations ALTER COLUMN tenant SET NOT NULL;
  `);

  await knex.raw(`
    ALTER TABLE company_tax_rates DROP CONSTRAINT IF EXISTS company_tax_rates_location_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE company_locations DROP CONSTRAINT IF EXISTS company_locations_company_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE company_locations DROP CONSTRAINT IF EXISTS company_locations_pkey;
  `);

  await knex.raw(`
    ALTER TABLE company_locations ADD CONSTRAINT company_locations_pkey PRIMARY KEY (location_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE company_locations ADD CONSTRAINT company_locations_company_id_tenant_foreign 
    FOREIGN KEY (company_id, tenant) REFERENCES companies(company_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE company_tax_rates ADD CONSTRAINT company_tax_rates_location_id_tenant_foreign 
    FOREIGN KEY (location_id, tenant) REFERENCES company_locations(location_id, tenant) ON DELETE SET NULL;
  `);

  // Document versions migration - tenant column already exists
  await knex.raw(`
    ALTER TABLE document_block_content DROP CONSTRAINT IF EXISTS document_block_content_version_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE document_versions DROP CONSTRAINT IF EXISTS document_versions_pkey;
  `);

  await knex.raw(`
    ALTER TABLE document_versions ADD CONSTRAINT document_versions_pkey PRIMARY KEY (version_id, tenant);
  `);

  // Update document_block_content primary key to include tenant
  await knex.raw(`
    ALTER TABLE document_block_content DROP CONSTRAINT IF EXISTS document_block_content_pkey;
  `);

  await knex.raw(`
    ALTER TABLE document_block_content ADD CONSTRAINT document_block_content_pkey PRIMARY KEY (content_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE document_block_content ADD CONSTRAINT document_block_content_version_id_foreign 
    FOREIGN KEY (version_id, tenant) REFERENCES document_versions(version_id, tenant);
  `);

  // Event catalog migration - tenant column already exists
  await knex.raw(`
    ALTER TABLE event_catalog DROP CONSTRAINT IF EXISTS event_catalog_pkey;
  `);

  await knex.raw(`
    ALTER TABLE event_catalog ADD CONSTRAINT event_catalog_pkey PRIMARY KEY (event_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE event_catalog ADD CONSTRAINT event_catalog_tenant_foreign 
    FOREIGN KEY (tenant) REFERENCES tenants(tenant);
  `);

  // Invoice item details migration - remove ON DELETE clause
  await knex.raw(`
    ALTER TABLE invoice_item_details DROP CONSTRAINT IF EXISTS invoice_item_details_tenant_service_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE invoice_item_details DROP CONSTRAINT IF EXISTS invoice_item_details_tenant_config_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE invoice_item_details ADD CONSTRAINT invoice_item_details_tenant_service_id_foreign 
    FOREIGN KEY (tenant, service_id) REFERENCES service_catalog(tenant, service_id);
  `);

  await knex.raw(`
    ALTER TABLE invoice_item_details ADD CONSTRAINT invoice_item_details_tenant_config_id_foreign 
    FOREIGN KEY (tenant, config_id) REFERENCES plan_service_configuration(tenant, config_id);
  `);

  // Invoice time entries migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE invoice_time_entries DROP CONSTRAINT IF EXISTS invoice_time_entries_pkey;
  `);

  await knex.raw(`
    ALTER TABLE invoice_time_entries ADD CONSTRAINT invoice_time_entries_pkey PRIMARY KEY (invoice_time_entry_id, tenant);
  `);

  // Invoice usage records migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE invoice_usage_records DROP CONSTRAINT IF EXISTS invoice_usage_records_pkey;
  `);

  await knex.raw(`
    ALTER TABLE invoice_usage_records ADD CONSTRAINT invoice_usage_records_pkey PRIMARY KEY (invoice_usage_record_id, tenant);
  `);

  // Service rate tiers migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE service_rate_tiers DROP CONSTRAINT IF EXISTS service_rate_tiers_pkey;
  `);

  await knex.raw(`
    ALTER TABLE service_rate_tiers ADD CONSTRAINT service_rate_tiers_pkey PRIMARY KEY (tenant, tier_id);
  `);

  // Tax components migration - add tenant to primary key
  // First create a unique index on tax_component_id to maintain referential integrity
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS tax_components_tax_component_id_idx ON tax_components(tax_component_id);
  `);

  // Drop the foreign key constraint that depends on the primary key
  await knex.raw(`
    ALTER TABLE composite_tax_mappings DROP CONSTRAINT IF EXISTS composite_tax_mappings_tax_component_id_foreign;
  `);

  // Now we can safely drop and recreate the primary key
  await knex.raw(`
    ALTER TABLE tax_components DROP CONSTRAINT IF EXISTS tax_components_pkey;
  `);

  await knex.raw(`
    ALTER TABLE tax_components ADD CONSTRAINT tax_components_pkey PRIMARY KEY (tenant, tax_component_id);
  `);

  // Re-add the foreign key constraint, but now referencing the unique index
  await knex.raw(`
    ALTER TABLE composite_tax_mappings ADD CONSTRAINT composite_tax_mappings_tax_component_id_foreign 
    FOREIGN KEY (tax_component_id) REFERENCES tax_components(tax_component_id);
  `);

  // Tenant external entity mappings migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE tenant_external_entity_mappings DROP CONSTRAINT IF EXISTS tenant_external_entity_mappings_pkey;
  `);

  await knex.raw(`
    ALTER TABLE tenant_external_entity_mappings ADD CONSTRAINT tenant_external_entity_mappings_pkey PRIMARY KEY (id, tenant);
  `);

  // Time sheet comments migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE time_sheet_comments DROP CONSTRAINT IF EXISTS time_sheet_comments_pkey;
  `);

  await knex.raw(`
    ALTER TABLE time_sheet_comments ADD CONSTRAINT time_sheet_comments_pkey PRIMARY KEY (comment_id, tenant);
  `);

  // Transactions migration - update primary key and foreign keys
  await knex.raw(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_company_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_invoice_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_related_transaction_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_parent_transaction_id_foreign;
  `);

  // Make sure to drop the credit_allocations foreign key first
  await knex.raw(`
    ALTER TABLE credit_allocations DROP CONSTRAINT IF EXISTS credit_allocations_transaction_id_foreign;
  `);

  // Create a unique constraint on transaction_id to maintain referential integrity
  await knex.raw(`
    ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_id_unique UNIQUE (transaction_id);
  `);

  // Now we can safely drop and recreate the primary key
  await knex.raw(`
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_pkey;
  `);

  await knex.raw(`
    ALTER TABLE transactions ADD CONSTRAINT transactions_pkey PRIMARY KEY (transaction_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE transactions ADD CONSTRAINT transactions_company_id_tenant_foreign 
    FOREIGN KEY (company_id, tenant) REFERENCES companies(company_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE transactions ADD CONSTRAINT transactions_invoice_id_tenant_foreign 
    FOREIGN KEY (invoice_id, tenant) REFERENCES invoices(invoice_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE transactions ADD CONSTRAINT transactions_related_transaction_id_tenant_foreign 
    FOREIGN KEY (related_transaction_id, tenant) REFERENCES transactions(transaction_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE transactions ADD CONSTRAINT transactions_parent_transaction_id_tenant_foreign 
    FOREIGN KEY (parent_transaction_id, tenant) REFERENCES transactions(transaction_id, tenant);
  `);

  // Add both foreign key constraints

  await knex.raw(`
    ALTER TABLE credit_allocations ADD CONSTRAINT credit_allocations_transaction_id_tenant_foreign 
    FOREIGN KEY (transaction_id, tenant) REFERENCES transactions(transaction_id, tenant);
  `);
  
  // Also recreate the original foreign key constraint referencing just transaction_id
  await knex.raw(`
    ALTER TABLE credit_allocations ADD CONSTRAINT credit_allocations_transaction_id_foreign 
    FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id);
  `);

  // User type rates migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE user_type_rates DROP CONSTRAINT IF EXISTS user_type_rates_pkey;
  `);

  await knex.raw(`
    ALTER TABLE user_type_rates ADD CONSTRAINT user_type_rates_pkey PRIMARY KEY (tenant, rate_id);
  `);

  // Workflow tables migration - update primary keys and foreign keys
  // First, drop all foreign key constraints that reference workflow_executions
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_action_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_depends_on_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_tenant_execution_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_results DROP CONSTRAINT IF EXISTS workflow_action_results_tenant_execution_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_processing DROP CONSTRAINT IF EXISTS workflow_event_processing_execution_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_snapshots DROP CONSTRAINT IF EXISTS workflow_snapshots_execution_id_foreign;
  `);

  // Then drop the primary keys
  await knex.raw(`
    ALTER TABLE workflow_action_dependencies DROP CONSTRAINT IF EXISTS workflow_action_dependencies_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_results DROP CONSTRAINT IF EXISTS workflow_action_results_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_executions DROP CONSTRAINT IF EXISTS workflow_executions_pkey;
  `);

  // Add new primary keys that include tenant
  await knex.raw(`
    ALTER TABLE workflow_executions ADD CONSTRAINT workflow_executions_pkey PRIMARY KEY (execution_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_results ADD CONSTRAINT workflow_action_results_pkey PRIMARY KEY (result_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_pkey PRIMARY KEY (dependency_id, tenant);
  `);

  // Add new foreign key constraints that include tenant
  await knex.raw(`
    ALTER TABLE workflow_action_results ADD CONSTRAINT workflow_action_results_tenant_execution_id_foreign 
    FOREIGN KEY (execution_id, tenant) REFERENCES workflow_executions(execution_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_tenant_execution_id_foreign 
    FOREIGN KEY (execution_id, tenant) REFERENCES workflow_executions(execution_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_processing ADD CONSTRAINT workflow_event_processing_execution_id_tenant_foreign 
    FOREIGN KEY (execution_id, tenant) REFERENCES workflow_executions(execution_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_snapshots ADD CONSTRAINT workflow_snapshots_execution_id_tenant_foreign 
    FOREIGN KEY (execution_id, tenant) REFERENCES workflow_executions(execution_id, tenant);
  `);

  // Workflow event attachments migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE workflow_event_attachments DROP CONSTRAINT IF EXISTS workflow_event_attachments_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_attachments ADD CONSTRAINT workflow_event_attachments_pkey PRIMARY KEY (tenant, attachment_id);
  `);

  // Workflow snapshots migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE workflow_snapshots DROP CONSTRAINT IF EXISTS workflow_snapshots_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_snapshots ADD CONSTRAINT workflow_snapshots_pkey PRIMARY KEY (tenant, snapshot_id);
  `);

  // Workflow sync points migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE workflow_sync_points DROP CONSTRAINT IF EXISTS workflow_sync_points_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_sync_points ADD CONSTRAINT workflow_sync_points_pkey PRIMARY KEY (tenant, sync_id);
  `);

  // Workflow task definitions, tasks, and task history migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE workflow_task_history DROP CONSTRAINT IF EXISTS workflow_task_history_task_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_tasks DROP CONSTRAINT IF EXISTS fk_wt_tenant_task_def_id;
  `);

  await knex.raw(`
    ALTER TABLE workflow_task_history DROP CONSTRAINT IF EXISTS workflow_task_history_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_tasks DROP CONSTRAINT IF EXISTS workflow_tasks_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_task_definitions DROP CONSTRAINT IF EXISTS workflow_task_definitions_pkey;
  `);

  // Add new primary keys that include tenant
  await knex.raw(`
    ALTER TABLE workflow_task_definitions ADD CONSTRAINT workflow_task_definitions_pkey PRIMARY KEY (task_definition_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_tasks ADD CONSTRAINT workflow_tasks_pkey PRIMARY KEY (task_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_task_history ADD CONSTRAINT workflow_task_history_pkey PRIMARY KEY (history_id, tenant);
  `);

  // Add new foreign key constraints that include tenant
  await knex.raw(`
    ALTER TABLE workflow_tasks ADD CONSTRAINT fk_wt_tenant_task_def_id 
    FOREIGN KEY (tenant_task_definition_id, tenant) REFERENCES workflow_task_definitions(task_definition_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_task_history ADD CONSTRAINT workflow_task_history_task_id_tenant_foreign 
    FOREIGN KEY (task_id, tenant) REFERENCES workflow_tasks(task_id, tenant);
  `);

  // Workflow template categories migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE workflow_template_categories DROP CONSTRAINT IF EXISTS workflow_template_categories_parent_category_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_template_categories DROP CONSTRAINT IF EXISTS workflow_template_categories_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_template_categories ADD CONSTRAINT workflow_template_categories_pkey PRIMARY KEY (category_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_template_categories ADD CONSTRAINT workflow_template_categories_parent_category_id_tenant_foreign 
    FOREIGN KEY (parent_category_id, tenant) REFERENCES workflow_template_categories(category_id, tenant);
  `);

  // Workflow timers migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE workflow_timers DROP CONSTRAINT IF EXISTS workflow_timers_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_timers ADD CONSTRAINT workflow_timers_pkey PRIMARY KEY (tenant, timer_id);
  `);

  // Workflow triggers migration - update primary key to include tenant
  await knex.raw(`
    ALTER TABLE workflow_event_mappings DROP CONSTRAINT IF EXISTS workflow_event_mappings_trigger_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_triggers DROP CONSTRAINT IF EXISTS workflow_triggers_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_triggers ADD CONSTRAINT workflow_triggers_pkey PRIMARY KEY (trigger_id, tenant);
  `);


  // Workflow events and event processing migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE workflow_event_processing DROP CONSTRAINT IF EXISTS workflow_event_processing_event_id_foreign;
  `);
  
  await knex.raw(`
    ALTER TABLE workflow_event_processing DROP CONSTRAINT IF EXISTS workflow_event_processing_event_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_events DROP CONSTRAINT IF EXISTS workflow_events_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_events DROP CONSTRAINT IF EXISTS workflow_events_tenant_execution_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_processing DROP CONSTRAINT IF EXISTS workflow_event_processing_pkey;
  `);

  // Add new primary keys that include tenant
  await knex.raw(`
    ALTER TABLE workflow_events ADD CONSTRAINT workflow_events_pkey PRIMARY KEY (event_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_processing ADD CONSTRAINT workflow_event_processing_pkey PRIMARY KEY (processing_id, tenant);
  `);

  // Add new foreign key constraint
  await knex.raw(`
    ALTER TABLE workflow_event_processing ADD CONSTRAINT workflow_event_processing_event_id_tenant_foreign 
    FOREIGN KEY (event_id, tenant) REFERENCES workflow_events(event_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_action_id_tenant_foreign 
    FOREIGN KEY (action_id, tenant) REFERENCES workflow_action_results(result_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies ADD CONSTRAINT workflow_action_dependencies_depends_on_id_tenant_foreign 
    FOREIGN KEY (depends_on_id, tenant) REFERENCES workflow_action_results(result_id, tenant);
  `);

  // Workflow form definitions and schemas migration - add tenant to primary key and fix data types
  await knex.raw(`
    ALTER TABLE workflow_form_schemas DROP CONSTRAINT IF EXISTS workflow_form_schemas_form_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_form_schemas DROP CONSTRAINT IF EXISTS workflow_form_schemas_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_form_definitions DROP CONSTRAINT IF EXISTS workflow_form_definitions_pkey;
  `);

  // Add new primary keys that include tenant
  await knex.raw(`
    ALTER TABLE workflow_form_definitions ADD CONSTRAINT workflow_form_definitions_pkey PRIMARY KEY (form_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_form_schemas ADD CONSTRAINT workflow_form_schemas_pkey PRIMARY KEY (schema_id, tenant);
  `);

  // Add new foreign key constraint
  await knex.raw(`
    ALTER TABLE workflow_form_schemas ADD CONSTRAINT workflow_form_schemas_form_id_tenant_foreign 
    FOREIGN KEY (form_id, tenant) REFERENCES workflow_form_definitions(form_id, tenant);
  `);

  // Workflow templates, registrations, and registration versions migration - add tenant to primary key
  await knex.raw(`
    ALTER TABLE workflow_registration_versions DROP CONSTRAINT IF EXISTS workflow_registration_versions_registration_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_registrations DROP CONSTRAINT IF EXISTS workflow_registrations_source_template_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_registration_versions DROP CONSTRAINT IF EXISTS workflow_registration_versions_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_registrations DROP CONSTRAINT IF EXISTS workflow_registrations_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_templates DROP CONSTRAINT IF EXISTS workflow_templates_pkey;
  `);

  // Add new primary keys that include tenant
  await knex.raw(`
    ALTER TABLE workflow_templates ADD CONSTRAINT workflow_templates_pkey PRIMARY KEY (template_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_registrations ADD CONSTRAINT workflow_registrations_pkey PRIMARY KEY (registration_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_registration_versions ADD CONSTRAINT workflow_registration_versions_pkey PRIMARY KEY (version_id, tenant);
  `);

  // Drop and recreate unique indexes on workflow_registration_versions to include tenant
  await knex.raw(`
    DROP INDEX IF EXISTS idx_workflow_registration_versions_reg_version;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_workflow_registration_versions_current;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_workflow_registration_versions_reg_version 
    ON workflow_registration_versions (registration_id, version, tenant);
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_workflow_registration_versions_current 
    ON workflow_registration_versions (registration_id, tenant) 
    WHERE (is_current = true);
  `);

  // Add new foreign key constraints that include tenant
  await knex.raw(`
    ALTER TABLE workflow_registrations ADD CONSTRAINT workflow_registrations_source_template_id_tenant_foreign 
    FOREIGN KEY (source_template_id, tenant) REFERENCES workflow_templates(template_id, tenant);
  `);

  await knex.raw(`
    ALTER TABLE workflow_registration_versions ADD CONSTRAINT workflow_registration_versions_registration_id_tenant_foreign 
    FOREIGN KEY (registration_id, tenant) REFERENCES workflow_registrations(registration_id, tenant);
  `);
};

exports.down = async function(knex) {
  // Revert workflow templates, registrations, and registration versions changes
  await knex.raw(`
    ALTER TABLE workflow_registration_versions 
    DROP CONSTRAINT IF EXISTS workflow_registration_versions_registration_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_registrations 
    DROP CONSTRAINT IF EXISTS workflow_registrations_source_template_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_registration_versions 
    DROP CONSTRAINT IF EXISTS workflow_registration_versions_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_registrations 
    DROP CONSTRAINT IF EXISTS workflow_registrations_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_templates 
    DROP CONSTRAINT IF EXISTS workflow_templates_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_templates 
    ADD CONSTRAINT workflow_templates_pkey PRIMARY KEY (template_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_registrations 
    ADD CONSTRAINT workflow_registrations_pkey PRIMARY KEY (registration_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_registration_versions 
    ADD CONSTRAINT workflow_registration_versions_pkey PRIMARY KEY (version_id);
  `);

  // Recreate original unique indexes on workflow_registration_versions
  await knex.raw(`
    DROP INDEX IF EXISTS idx_workflow_registration_versions_reg_version;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS idx_workflow_registration_versions_current;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_workflow_registration_versions_reg_version 
    ON workflow_registration_versions (registration_id, version);
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_workflow_registration_versions_current 
    ON workflow_registration_versions (registration_id) 
    WHERE (is_current = true);
  `);

  await knex.raw(`
    ALTER TABLE workflow_registrations 
    ADD CONSTRAINT workflow_registrations_source_template_id_foreign 
    FOREIGN KEY (source_template_id) REFERENCES workflow_templates(template_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_registration_versions 
    ADD CONSTRAINT workflow_registration_versions_registration_id_foreign 
    FOREIGN KEY (registration_id) REFERENCES workflow_registrations(registration_id);
  `);

  // Revert workflow form definitions and schemas changes
  await knex.raw(`
    ALTER TABLE workflow_form_schemas 
    DROP CONSTRAINT IF EXISTS workflow_form_schemas_form_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_form_schemas 
    DROP CONSTRAINT IF EXISTS workflow_form_schemas_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_form_definitions 
    DROP CONSTRAINT IF EXISTS workflow_form_definitions_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_form_schemas 
    ADD CONSTRAINT workflow_form_schemas_pkey PRIMARY KEY (schema_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_form_definitions 
    ADD CONSTRAINT workflow_form_definitions_pkey PRIMARY KEY (form_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_form_schemas 
    ADD CONSTRAINT workflow_form_schemas_form_id_foreign 
    FOREIGN KEY (form_id) REFERENCES workflow_form_definitions(form_id);
  `);

  // Revert workflow events and event processing changes
  await knex.raw(`
    ALTER TABLE workflow_event_processing 
    DROP CONSTRAINT IF EXISTS workflow_event_processing_event_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_processing 
    DROP CONSTRAINT IF EXISTS workflow_event_processing_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_events 
    DROP CONSTRAINT IF EXISTS workflow_events_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_processing 
    ADD CONSTRAINT workflow_event_processing_pkey PRIMARY KEY (processing_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_events 
    ADD CONSTRAINT workflow_events_pkey PRIMARY KEY (event_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_processing 
    ADD CONSTRAINT workflow_event_processing_event_id_foreign 
    FOREIGN KEY (event_id) REFERENCES workflow_events(event_id);
  `);

  // Revert workflow triggers changes
  await knex.raw(`
    ALTER TABLE workflow_triggers 
    DROP CONSTRAINT IF EXISTS workflow_triggers_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_triggers 
    ADD CONSTRAINT workflow_triggers_pkey PRIMARY KEY (trigger_id);
  `);

  // Revert workflow timers changes
  await knex.raw(`
    ALTER TABLE workflow_timers 
    DROP CONSTRAINT IF EXISTS workflow_timers_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_timers 
    ADD CONSTRAINT workflow_timers_pkey PRIMARY KEY (timer_id);
  `);

  // Revert workflow template categories changes
  await knex.raw(`
    ALTER TABLE workflow_template_categories 
    DROP CONSTRAINT IF EXISTS workflow_template_categories_parent_category_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_template_categories 
    DROP CONSTRAINT IF EXISTS workflow_template_categories_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_template_categories 
    ADD CONSTRAINT workflow_template_categories_pkey PRIMARY KEY (category_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_template_categories 
    ADD CONSTRAINT workflow_template_categories_parent_category_id_foreign 
    FOREIGN KEY (parent_category_id) REFERENCES workflow_template_categories(category_id);
  `);

  // Revert workflow task definitions, tasks, and task history changes
  await knex.raw(`
    ALTER TABLE workflow_task_history 
    DROP CONSTRAINT IF EXISTS workflow_task_history_task_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_tasks 
    DROP CONSTRAINT IF EXISTS fk_wt_tenant_task_def_id;
  `);

  await knex.raw(`
    ALTER TABLE workflow_task_history 
    DROP CONSTRAINT IF EXISTS workflow_task_history_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_tasks 
    DROP CONSTRAINT IF EXISTS workflow_tasks_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_task_definitions 
    DROP CONSTRAINT IF EXISTS workflow_task_definitions_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_task_definitions 
    ADD CONSTRAINT workflow_task_definitions_pkey PRIMARY KEY (task_definition_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_tasks 
    ADD CONSTRAINT workflow_tasks_pkey PRIMARY KEY (task_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_task_history 
    ADD CONSTRAINT workflow_task_history_pkey PRIMARY KEY (history_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_tasks 
    ADD CONSTRAINT fk_wt_tenant_task_def_id 
    FOREIGN KEY (tenant_task_definition_id) REFERENCES workflow_task_definitions(task_definition_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_task_history 
    ADD CONSTRAINT workflow_task_history_task_id_foreign 
    FOREIGN KEY (task_id) REFERENCES workflow_tasks(task_id);
  `);

  // Revert workflow sync points changes
  await knex.raw(`
    ALTER TABLE workflow_sync_points 
    DROP CONSTRAINT IF EXISTS workflow_sync_points_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_sync_points 
    ADD CONSTRAINT workflow_sync_points_pkey PRIMARY KEY (sync_id);
  `);

  // Revert workflow snapshots changes
  await knex.raw(`
    ALTER TABLE workflow_snapshots 
    DROP CONSTRAINT IF EXISTS workflow_snapshots_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_snapshots 
    ADD CONSTRAINT workflow_snapshots_pkey PRIMARY KEY (snapshot_id);
  `);

  // Revert workflow event attachments changes
  await knex.raw(`
    ALTER TABLE workflow_event_attachments 
    DROP CONSTRAINT IF EXISTS workflow_event_attachments_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_attachments 
    ADD CONSTRAINT workflow_event_attachments_pkey PRIMARY KEY (attachment_id);
  `);

  // Revert workflow tables changes
  await knex.raw(`
    ALTER TABLE workflow_snapshots 
    DROP CONSTRAINT IF EXISTS workflow_snapshots_execution_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_processing 
    DROP CONSTRAINT IF EXISTS workflow_event_processing_execution_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies 
    DROP CONSTRAINT IF EXISTS workflow_action_dependencies_depends_on_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies 
    DROP CONSTRAINT IF EXISTS workflow_action_dependencies_action_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies 
    DROP CONSTRAINT IF EXISTS workflow_action_dependencies_tenant_execution_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_results 
    DROP CONSTRAINT IF EXISTS workflow_action_results_tenant_execution_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies 
    DROP CONSTRAINT IF EXISTS workflow_action_dependencies_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_results 
    DROP CONSTRAINT IF EXISTS workflow_action_results_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_executions 
    DROP CONSTRAINT IF EXISTS workflow_executions_pkey;
  `);

  await knex.raw(`
    ALTER TABLE workflow_executions 
    ADD CONSTRAINT workflow_executions_pkey PRIMARY KEY (execution_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_results 
    ADD CONSTRAINT workflow_action_results_pkey PRIMARY KEY (result_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies 
    ADD CONSTRAINT workflow_action_dependencies_pkey PRIMARY KEY (dependency_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_results 
    ADD CONSTRAINT workflow_action_results_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies 
    ADD CONSTRAINT workflow_action_dependencies_tenant_execution_id_foreign 
    FOREIGN KEY (tenant, execution_id) REFERENCES workflow_executions(tenant, execution_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_event_processing 
    ADD CONSTRAINT workflow_event_processing_execution_id_foreign 
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(execution_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_snapshots 
    ADD CONSTRAINT workflow_snapshots_execution_id_foreign 
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(execution_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies 
    ADD CONSTRAINT workflow_action_dependencies_action_id_foreign 
    FOREIGN KEY (action_id) REFERENCES workflow_action_results(result_id);
  `);

  await knex.raw(`
    ALTER TABLE workflow_action_dependencies 
    ADD CONSTRAINT workflow_action_dependencies_depends_on_id_foreign 
    FOREIGN KEY (depends_on_id) REFERENCES workflow_action_results(result_id);
  `);

  // Revert user type rates changes
  await knex.raw(`
    ALTER TABLE user_type_rates 
    DROP CONSTRAINT IF EXISTS user_type_rates_pkey;
  `);

  await knex.raw(`
    ALTER TABLE user_type_rates 
    ADD CONSTRAINT user_type_rates_pkey PRIMARY KEY (rate_id);
  `);

  // Revert credit_allocations changes
  await knex.raw(`
    ALTER TABLE credit_allocations 
    DROP CONSTRAINT IF EXISTS credit_allocations_transaction_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE credit_allocations 
    ADD CONSTRAINT credit_allocations_transaction_id_foreign 
    FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id);
  `);

  // Revert transactions changes
  await knex.raw(`
    ALTER TABLE transactions 
    DROP CONSTRAINT IF EXISTS transactions_parent_transaction_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE transactions 
    DROP CONSTRAINT IF EXISTS transactions_related_transaction_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE transactions 
    DROP CONSTRAINT IF EXISTS transactions_invoice_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE transactions 
    DROP CONSTRAINT IF EXISTS transactions_company_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE transactions 
    DROP CONSTRAINT IF EXISTS transactions_pkey;
  `);

  await knex.raw(`
    ALTER TABLE transactions 
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (transaction_id);
  `);

  await knex.raw(`
    ALTER TABLE transactions 
    ADD CONSTRAINT transactions_company_id_foreign 
    FOREIGN KEY (company_id) REFERENCES companies(company_id);
  `);

  await knex.raw(`
    ALTER TABLE transactions 
    ADD CONSTRAINT transactions_invoice_id_foreign 
    FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id);
  `);

  await knex.raw(`
    ALTER TABLE transactions 
    ADD CONSTRAINT transactions_related_transaction_id_foreign 
    FOREIGN KEY (related_transaction_id) REFERENCES transactions(transaction_id);
  `);

  await knex.raw(`
    ALTER TABLE transactions 
    ADD CONSTRAINT transactions_parent_transaction_id_foreign 
    FOREIGN KEY (parent_transaction_id) REFERENCES transactions(transaction_id);
  `);

  // Revert time sheet comments changes
  await knex.raw(`
    ALTER TABLE time_sheet_comments 
    DROP CONSTRAINT IF EXISTS time_sheet_comments_pkey;
  `);

  await knex.raw(`
    ALTER TABLE time_sheet_comments 
    ADD CONSTRAINT time_sheet_comments_pkey PRIMARY KEY (comment_id);
  `);

  // Revert tenant external entity mappings changes
  await knex.raw(`
    ALTER TABLE tenant_external_entity_mappings 
    DROP CONSTRAINT IF EXISTS tenant_external_entity_mappings_pkey;
  `);

  await knex.raw(`
    ALTER TABLE tenant_external_entity_mappings 
    ADD CONSTRAINT tenant_external_entity_mappings_pkey PRIMARY KEY (id);
  `);

  // Revert tax components changes
  await knex.raw(`
    ALTER TABLE tax_components 
    DROP CONSTRAINT IF EXISTS tax_components_pkey;
  `);

  await knex.raw(`
    ALTER TABLE tax_components 
    ADD CONSTRAINT tax_components_pkey PRIMARY KEY (tax_component_id);
  `);

  // Revert service rate tiers changes
  await knex.raw(`
    ALTER TABLE service_rate_tiers 
    DROP CONSTRAINT IF EXISTS service_rate_tiers_pkey;
  `);

  await knex.raw(`
    ALTER TABLE service_rate_tiers 
    ADD CONSTRAINT service_rate_tiers_pkey PRIMARY KEY (tier_id);
  `);

  // Revert invoice usage records changes
  await knex.raw(`
    ALTER TABLE invoice_usage_records 
    DROP CONSTRAINT IF EXISTS invoice_usage_records_pkey;
  `);

  await knex.raw(`
    ALTER TABLE invoice_usage_records 
    ADD CONSTRAINT invoice_usage_records_pkey PRIMARY KEY (invoice_usage_record_id);
  `);

  // Revert invoice time entries changes
  await knex.raw(`
    ALTER TABLE invoice_time_entries 
    DROP CONSTRAINT IF EXISTS invoice_time_entries_pkey;
  `);

  await knex.raw(`
    ALTER TABLE invoice_time_entries 
    ADD CONSTRAINT invoice_time_entries_pkey PRIMARY KEY (invoice_time_entry_id);
  `);

  // No need to revert invoice item details changes since we're removing the ON DELETE clause

  // Revert event catalog changes
  await knex.raw(`
    ALTER TABLE event_catalog 
    DROP CONSTRAINT IF EXISTS event_catalog_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE event_catalog 
    DROP CONSTRAINT IF EXISTS event_catalog_pkey;
  `);

  await knex.raw(`
    ALTER TABLE event_catalog 
    ADD CONSTRAINT event_catalog_pkey PRIMARY KEY (event_id);
  `);

  // Revert document versions changes
  await knex.raw(`
    ALTER TABLE document_block_content 
    DROP CONSTRAINT IF EXISTS document_block_content_version_id_foreign;
  `);

  await knex.raw(`
    ALTER TABLE document_block_content 
    DROP CONSTRAINT IF EXISTS document_block_content_pkey;
  `);

  await knex.raw(`
    ALTER TABLE document_block_content 
    ADD CONSTRAINT document_block_content_pkey PRIMARY KEY (content_id);
  `);

  await knex.raw(`
    ALTER TABLE document_versions 
    DROP CONSTRAINT IF EXISTS document_versions_pkey;
  `);

  await knex.raw(`
    ALTER TABLE document_versions 
    ADD CONSTRAINT document_versions_pkey PRIMARY KEY (version_id);
  `);

  await knex.raw(`
    ALTER TABLE document_block_content 
    ADD CONSTRAINT document_block_content_version_id_foreign 
    FOREIGN KEY (version_id) REFERENCES document_versions(version_id);
  `);

  // Revert company locations changes
  await knex.raw(`
    ALTER TABLE company_tax_rates 
    DROP CONSTRAINT IF EXISTS company_tax_rates_location_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE company_locations 
    DROP CONSTRAINT IF EXISTS company_locations_company_id_tenant_foreign;
  `);

  await knex.raw(`
    ALTER TABLE company_locations 
    DROP CONSTRAINT IF EXISTS company_locations_pkey;
  `);

  await knex.raw(`
    ALTER TABLE company_locations 
    DROP COLUMN IF EXISTS tenant;
  `);

  await knex.raw(`
    ALTER TABLE company_locations 
    ADD CONSTRAINT company_locations_pkey PRIMARY KEY (location_id);
  `);

  await knex.raw(`
    ALTER TABLE company_locations 
    ADD CONSTRAINT company_locations_company_id_foreign 
    FOREIGN KEY (company_id) REFERENCES companies(company_id);
  `);

  await knex.raw(`
    ALTER TABLE company_tax_rates 
    ADD CONSTRAINT company_tax_rates_location_id_foreign 
    FOREIGN KEY (location_id) REFERENCES company_locations(location_id) ON DELETE SET NULL;
  `);
};
