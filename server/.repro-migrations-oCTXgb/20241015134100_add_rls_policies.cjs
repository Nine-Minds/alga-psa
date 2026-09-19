exports.up = function(knex) {
  return knex.raw(`
    -- ENABLE ROW LEVEL SECURITY on all tables
    ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE statuses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
    ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
    ALTER TABLE priorities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE severities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE urgencies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE impacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE next_number ENABLE ROW LEVEL SECURITY;
    ALTER TABLE attribute_definitions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;
    ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
    ALTER TABLE interaction_types ENABLE ROW LEVEL SECURITY;
    ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
    ALTER TABLE service_catalog ENABLE ROW LEVEL SECURITY;
    ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bucket_plans ENABLE ROW LEVEL SECURITY;
    ALTER TABLE bucket_usage ENABLE ROW LEVEL SECURITY;
    ALTER TABLE plan_services ENABLE ROW LEVEL SECURITY;
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE time_period_types ENABLE ROW LEVEL SECURITY;
    ALTER TABLE time_periods ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tenant_time_period_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE time_sheets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
    ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
    ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;
    ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE project_ticket_links ENABLE ROW LEVEL SECURITY;
    ALTER TABLE schedule_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE schedule_conflicts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
    ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
    ALTER TABLE approval_levels ENABLE ROW LEVEL SECURITY;
    ALTER TABLE approval_thresholds ENABLE ROW LEVEL SECURITY;
    ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ticket_resources ENABLE ROW LEVEL SECURITY;
    ALTER TABLE invoice_templates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE template_sections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE layout_blocks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;
    ALTER TABLE invoice_annotations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE conditional_display_rules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE standard_statuses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE time_sheet_comments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE company_billing_cycles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE plan_discounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE company_tax_rates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE company_locations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE company_tax_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tax_components ENABLE ROW LEVEL SECURITY;
    ALTER TABLE composite_tax_mappings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tax_rate_thresholds ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tax_holidays ENABLE ROW LEVEL SECURITY;
    ALTER TABLE project_status_mappings ENABLE ROW LEVEL SECURITY;


    -- Create a policy for each table

    CREATE POLICY tenant_isolation_policy ON tenants
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON sessions
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON companies
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON contacts
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON statuses
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON channels
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON categories
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON priorities
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON severities
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON urgencies
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON impacts
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON next_number
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON attribute_definitions
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON tickets
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON comments
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON schedules
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON document_types
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON documents
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON tags
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON interaction_types
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON interactions
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON service_categories
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON service_catalog
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON billing_plans
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON bucket_plans
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON bucket_usage
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON plan_services
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON projects
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON time_period_types
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON time_periods
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON tenant_time_period_settings
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON time_sheets
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON time_entries
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON usage_tracking
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON invoices
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON invoice_items
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON project_phases
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON project_tasks
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON project_ticket_links
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON schedule_entries
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON resources
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON schedule_conflicts
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON teams
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON team_members
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON approval_levels
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON approval_thresholds
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON policies
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON ticket_resources
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON invoice_templates
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON template_sections
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON layout_blocks
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON custom_fields
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON invoice_annotations
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON conditional_display_rules
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON standard_statuses
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON task_checklist_items
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

      CREATE POLICY tenant_isolation_policy ON time_sheet_comments
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON company_billing_cycles
      USING (company_id IN (SELECT company_id FROM companies WHERE tenant::TEXT = current_setting('app.current_tenant')::TEXT));

    CREATE POLICY tenant_isolation_policy ON discounts
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON plan_discounts
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON tax_rates
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON company_tax_rates
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON company_locations
      USING (company_id IN (SELECT company_id FROM companies WHERE tenant::TEXT = current_setting('app.current_tenant')::TEXT));

    CREATE POLICY tenant_isolation_policy ON company_tax_settings
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);

    CREATE POLICY tenant_isolation_policy ON tax_components
      USING (tax_rate_id IN (SELECT tax_rate_id FROM tax_rates WHERE tenant::TEXT = current_setting('app.current_tenant')::TEXT));

    CREATE POLICY tenant_isolation_policy ON composite_tax_mappings
      USING (composite_tax_id IN (SELECT tax_rate_id FROM tax_rates WHERE tenant::TEXT = current_setting('app.current_tenant')::TEXT));

    CREATE POLICY tenant_isolation_policy ON tax_rate_thresholds
      USING (tax_rate_id IN (SELECT tax_rate_id FROM tax_rates WHERE tenant::TEXT = current_setting('app.current_tenant')::TEXT));

    CREATE POLICY tenant_isolation_policy ON tax_holidays
      USING (tax_rate_id IN (SELECT tax_rate_id FROM tax_rates WHERE tenant::TEXT = current_setting('app.current_tenant')::TEXT));

    CREATE POLICY tenant_isolation_policy ON project_status_mappings
      USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT);
       
  `);
};

exports.down = function(knex) {
  return knex.raw(`
    -- Disable Row Level Security on all tables
    ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
    ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
    ALTER TABLE companies DISABLE ROW LEVEL SECURITY;
    ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;
    ALTER TABLE statuses DISABLE ROW LEVEL SECURITY;
    ALTER TABLE channels DISABLE ROW LEVEL SECURITY;
    ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
    ALTER TABLE priorities DISABLE ROW LEVEL SECURITY;
    ALTER TABLE severities DISABLE ROW LEVEL SECURITY;
    ALTER TABLE urgencies DISABLE ROW LEVEL SECURITY;
    ALTER TABLE impacts DISABLE ROW LEVEL SECURITY;
    ALTER TABLE next_number DISABLE ROW LEVEL SECURITY;
    ALTER TABLE attribute_definitions DISABLE ROW LEVEL SECURITY;
    ALTER TABLE tickets DISABLE ROW LEVEL SECURITY;
    ALTER TABLE comments DISABLE ROW LEVEL SECURITY;
    ALTER TABLE schedules DISABLE ROW LEVEL SECURITY;
    ALTER TABLE document_types DISABLE ROW LEVEL SECURITY;
    ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
    ALTER TABLE tags DISABLE ROW LEVEL SECURITY;
    ALTER TABLE interaction_types DISABLE ROW LEVEL SECURITY;
    ALTER TABLE interactions DISABLE ROW LEVEL SECURITY;
    ALTER TABLE service_categories DISABLE ROW LEVEL SECURITY;
    ALTER TABLE service_catalog DISABLE ROW LEVEL SECURITY;
    ALTER TABLE billing_plans DISABLE ROW LEVEL SECURITY;
    ALTER TABLE bucket_plans DISABLE ROW LEVEL SECURITY;
    ALTER TABLE bucket_usage DISABLE ROW LEVEL SECURITY;
    ALTER TABLE plan_services DISABLE ROW LEVEL SECURITY;
    ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
    ALTER TABLE time_period_types DISABLE ROW LEVEL SECURITY;
    ALTER TABLE time_periods DISABLE ROW LEVEL SECURITY;
    ALTER TABLE tenant_time_period_settings DISABLE ROW LEVEL SECURITY;
    ALTER TABLE time_sheets DISABLE ROW LEVEL SECURITY;
    ALTER TABLE time_entries DISABLE ROW LEVEL SECURITY;
    ALTER TABLE usage_tracking DISABLE ROW LEVEL SECURITY;
    ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
    ALTER TABLE invoice_items DISABLE ROW LEVEL SECURITY;
    ALTER TABLE project_phases DISABLE ROW LEVEL SECURITY;
    ALTER TABLE project_tasks DISABLE ROW LEVEL SECURITY;
    ALTER TABLE project_ticket_links DISABLE ROW LEVEL SECURITY;
    ALTER TABLE schedule_entries DISABLE ROW LEVEL SECURITY;
    ALTER TABLE resources DISABLE ROW LEVEL SECURITY;
    ALTER TABLE schedule_conflicts DISABLE ROW LEVEL SECURITY;
    ALTER TABLE teams DISABLE ROW LEVEL SECURITY;
    ALTER TABLE team_members DISABLE ROW LEVEL SECURITY;
    ALTER TABLE approval_levels DISABLE ROW LEVEL SECURITY;
    ALTER TABLE approval_thresholds DISABLE ROW LEVEL SECURITY;
    ALTER TABLE policies DISABLE ROW LEVEL SECURITY;
    ALTER TABLE ticket_resources DISABLE ROW LEVEL SECURITY;
    ALTER TABLE invoice_templates DISABLE ROW LEVEL SECURITY;
    ALTER TABLE template_sections DISABLE ROW LEVEL SECURITY;
    ALTER TABLE layout_blocks DISABLE ROW LEVEL SECURITY;
    ALTER TABLE custom_fields DISABLE ROW LEVEL SECURITY;
    ALTER TABLE invoice_annotations DISABLE ROW LEVEL SECURITY;
    ALTER TABLE conditional_display_rules DISABLE ROW LEVEL SECURITY;
    ALTER TABLE standard_statuses DISABLE ROW LEVEL SECURITY;
    ALTER TABLE task_checklist_items DISABLE ROW LEVEL SECURITY;
    ALTER TABLE time_sheet_comments DISABLE ROW LEVEL SECURITY;
    ALTER TABLE company_billing_cycles DISABLE ROW LEVEL SECURITY;
    ALTER TABLE discounts DISABLE ROW LEVEL SECURITY;
    ALTER TABLE plan_discounts DISABLE ROW LEVEL SECURITY;
    ALTER TABLE tax_rates DISABLE ROW LEVEL SECURITY;
    ALTER TABLE company_tax_rates DISABLE ROW LEVEL SECURITY;
    ALTER TABLE company_locations DISABLE ROW LEVEL SECURITY;
    ALTER TABLE company_tax_settings DISABLE ROW LEVEL SECURITY;
    ALTER TABLE tax_components DISABLE ROW LEVEL SECURITY;
    ALTER TABLE composite_tax_mappings DISABLE ROW LEVEL SECURITY;
    ALTER TABLE tax_rate_thresholds DISABLE ROW LEVEL SECURITY;
    ALTER TABLE tax_holidays DISABLE ROW LEVEL SECURITY;
    ALTER TABLE project_status_mappings DISABLE ROW LEVEL SECURITY;

    -- Drop the policies
    DROP POLICY IF EXISTS tenant_isolation_policy ON tenants;
    DROP POLICY IF EXISTS tenant_isolation_policy ON sessions;
    DROP POLICY IF EXISTS tenant_isolation_policy ON companies;
    DROP POLICY IF EXISTS tenant_isolation_policy ON contacts;
    DROP POLICY IF EXISTS tenant_isolation_policy ON statuses;
    DROP POLICY IF EXISTS tenant_isolation_policy ON channels;
    DROP POLICY IF EXISTS tenant_isolation_policy ON categories;
    DROP POLICY IF EXISTS tenant_isolation_policy ON priorities;
    DROP POLICY IF EXISTS tenant_isolation_policy ON severities;
    DROP POLICY IF EXISTS tenant_isolation_policy ON urgencies;
    DROP POLICY IF EXISTS tenant_isolation_policy ON impacts;
    DROP POLICY IF EXISTS tenant_isolation_policy ON next_number;
    DROP POLICY IF EXISTS tenant_isolation_policy ON attribute_definitions;
    DROP POLICY IF EXISTS tenant_isolation_policy ON tickets;
    DROP POLICY IF EXISTS tenant_isolation_policy ON comments;
    DROP POLICY IF EXISTS tenant_isolation_policy ON schedules;
    DROP POLICY IF EXISTS tenant_isolation_policy ON document_types;
    DROP POLICY IF EXISTS tenant_isolation_policy ON documents;
    DROP POLICY IF EXISTS tenant_isolation_policy ON tags;
    DROP POLICY IF EXISTS tenant_isolation_policy ON interaction_types;
    DROP POLICY IF EXISTS tenant_isolation_policy ON interactions;
    DROP POLICY IF EXISTS tenant_isolation_policy ON service_categories;
    DROP POLICY IF EXISTS tenant_isolation_policy ON service_catalog;
    DROP POLICY IF EXISTS tenant_isolation_policy ON billing_plans;
    DROP POLICY IF EXISTS tenant_isolation_policy ON bucket_plans;
    DROP POLICY IF EXISTS tenant_isolation_policy ON bucket_usage;
    DROP POLICY IF EXISTS tenant_isolation_policy ON plan_services;
    DROP POLICY IF EXISTS tenant_isolation_policy ON projects;
    DROP POLICY IF EXISTS tenant_isolation_policy ON time_period_types;
    DROP POLICY IF EXISTS tenant_isolation_policy ON time_periods;
    DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_time_period_settings;
    DROP POLICY IF EXISTS tenant_isolation_policy ON time_sheets;
    DROP POLICY IF EXISTS tenant_isolation_policy ON time_entries;
    DROP POLICY IF EXISTS tenant_isolation_policy ON usage_tracking;
    DROP POLICY IF EXISTS tenant_isolation_policy ON invoices;
    DROP POLICY IF EXISTS tenant_isolation_policy ON invoice_items;
    DROP POLICY IF EXISTS tenant_isolation_policy ON project_phases;
    DROP POLICY IF EXISTS tenant_isolation_policy ON project_tasks;
    DROP POLICY IF EXISTS tenant_isolation_policy ON project_ticket_links;
    DROP POLICY IF EXISTS tenant_isolation_policy ON schedule_entries;
    DROP POLICY IF EXISTS tenant_isolation_policy ON resources;
    DROP POLICY IF EXISTS tenant_isolation_policy ON schedule_conflicts;
    DROP POLICY IF EXISTS tenant_isolation_policy ON teams;
    DROP POLICY IF EXISTS tenant_isolation_policy ON team_members;
    DROP POLICY IF EXISTS tenant_isolation_policy ON approval_levels;
    DROP POLICY IF EXISTS tenant_isolation_policy ON approval_thresholds;
    DROP POLICY IF EXISTS tenant_isolation_policy ON policies;
    DROP POLICY IF EXISTS tenant_isolation_policy ON ticket_resources;
    DROP POLICY IF EXISTS tenant_isolation_policy ON invoice_templates;
    DROP POLICY IF EXISTS tenant_isolation_policy ON template_sections;
    DROP POLICY IF EXISTS tenant_isolation_policy ON layout_blocks;
    DROP POLICY IF EXISTS tenant_isolation_policy ON custom_fields;
    DROP POLICY IF EXISTS tenant_isolation_policy ON invoice_annotations;
    DROP POLICY IF EXISTS tenant_isolation_policy ON conditional_display_rules;
    DROP POLICY IF EXISTS tenant_isolation_policy ON standard_statuses;
    DROP POLICY IF EXISTS tenant_isolation_policy ON task_checklist_items;
    DROP POLICY IF EXISTS tenant_isolation_policy ON time_sheet_comments;
    DROP POLICY IF EXISTS tenant_isolation_policy ON company_billing_cycles;
    DROP POLICY IF EXISTS tenant_isolation_policy ON discounts;
    DROP POLICY IF EXISTS tenant_isolation_policy ON plan_discounts;
    DROP POLICY IF EXISTS tenant_isolation_policy ON tax_rates;
    DROP POLICY IF EXISTS tenant_isolation_policy ON company_tax_rates;
    DROP POLICY IF EXISTS tenant_isolation_policy ON company_locations;
    DROP POLICY IF EXISTS tenant_isolation_policy ON company_tax_settings;
    DROP POLICY IF EXISTS tenant_isolation_policy ON tax_components;
    DROP POLICY IF EXISTS tenant_isolation_policy ON composite_tax_mappings;
    DROP POLICY IF EXISTS tenant_isolation_policy ON tax_rate_thresholds;
    DROP POLICY IF EXISTS tenant_isolation_policy ON tax_holidays;
    DROP POLICY IF EXISTS tenant_isolation_policy ON project_status_mappings;

  `);
};
