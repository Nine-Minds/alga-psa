#!/usr/bin/env nu

# Tenant Cleanup Tool for Alga PSA
# 
# Usage:
#   ./cleanup-tenant.nu list                          # List all tenants
#   ./cleanup-tenant.nu inspect <tenant-id>           # Inspect tenant data
#   ./cleanup-tenant.nu cleanup <tenant-id>           # Cleanup tenant (dry-run)
#   ./cleanup-tenant.nu cleanup <tenant-id> --execute # Actually delete data
#
# Options:
#   --environment <local|production>   Environment to use (default: local)
#   --execute                          Actually delete data (without this, it's a dry run)
#   --preserve-tenant                  Keep the tenant record itself
#   --force                             Skip confirmation prompts

# Read secret from file
def read-secret [filename: string] {
    let secret_path = $"($env.PWD)/secrets/($filename)"
    if ($secret_path | path exists) {
        open $secret_path | str trim
    } else {
        null
    }
}

# Get database configuration
def get-db-config [env_name: string = "local"] {
    if $env_name == "local" {
        {
            host: ($env.DB_HOST? | default "localhost")
            port: ($env.DB_PORT? | default 5432)
            database: ($env.DB_NAME? | default "server")
            user: ($env.DB_USER? | default "postgres")
            password: ($env.DB_PASSWORD? | default "postpass123")
        }
    } else {
        let prod_password = (read-secret "db_password_prod") | default $env.PROD_DB_PASSWORD?
        let prod_host = (read-secret "db_host_prod") | default ($env.PROD_DB_HOST? | default "localhost")
        let prod_port = (read-secret "db_port_prod") | default ($env.PROD_DB_PORT? | default "5433")
        let prod_database = (read-secret "db_name_prod") | default ($env.PROD_DB_NAME? | default "server")
        let prod_user = (read-secret "db_user_prod") | default ($env.PROD_DB_USER? | default "postgres")
        
        if $prod_password == null {
            print "Production database password not found!"
            print "Please either:"
            print "1. Create secrets/db_password_prod file with the password"
            print "2. Or set PROD_DB_PASSWORD environment variable"
            exit 1
        }
        
        {
            host: $prod_host
            port: ($prod_port | into int)
            database: $prod_database
            user: $prod_user
            password: $prod_password
        }
    }
}

# Build PostgreSQL connection string
def build-connection-string [config: record] {
    $"postgresql://($config.user):($config.password)@($config.host):($config.port)/($config.database)"
}

# Execute SQL query
def execute-sql [
    query: string
    --env-name: string = "local"
] {
    let config = get-db-config $env_name
    let conn_str = build-connection-string $config
    
    psql $conn_str -t -A -c $query | lines | where {|line| $line != "" }
}

# Execute SQL query and return as table
def query-sql [
    query: string
    --env-name: string = "local"
] {
    let config = get-db-config $env_name
    let conn_str = build-connection-string $config
    
    psql $conn_str --csv -c $query | from csv
}

# List all tenants
def "main list" [
    --environment: string = "local"  # Environment to use
] {
    print $"Environment: ($environment)"
    print "\nFetching tenants...\n"
    
    let query = "
        SELECT 
            t.tenant,
            t.client_name,
            t.created_at,
            COUNT(DISTINCT u.user_id) as user_count,
            COUNT(DISTINCT tk.ticket_id) as ticket_count,
            MAX(tk.entered_at) as last_ticket_date
        FROM tenants t
        LEFT JOIN users u ON t.tenant = u.tenant
        LEFT JOIN tickets tk ON t.tenant = tk.tenant
        GROUP BY t.tenant, t.client_name, t.created_at
        ORDER BY t.created_at DESC
    "
    
    let tenants = query-sql $query --env-name $environment
    
    print $"Found ($tenants | length) tenants:\n"
    
    # Format and display the table with quick total counts
    let enriched_tenants = $tenants | each { |row|
        let user_count = if ($row.user_count? | is-empty) { 0 } else { $row.user_count | into int }
        let ticket_count = if ($row.ticket_count? | is-empty) { 0 } else { $row.ticket_count | into int }
        
        # Quick count of key tables for est_total_records (for performance)
        let count_query = "
            SELECT 
                (SELECT COUNT(*) FROM users WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM clients WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM contacts WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM tickets WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM projects WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM documents WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM time_entries WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM invoices WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM comments WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM roles WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM user_roles WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM role_permissions WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM workflow_executions WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM workflow_events WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM task_checklist_items WHERE tenant = '" + $row.tenant + "') +
                (SELECT COUNT(*) FROM project_tasks WHERE tenant = '" + $row.tenant + "')
                as est_total_records
        "
        
        let total_result = query-sql $count_query --env-name $environment | first
        let est_total_records = if ($total_result.est_total_records? | is-empty) { 0 } else { $total_result.est_total_records | into int }
        
        {
            tenant: $row.tenant
            client: $row.client_name
            created: ($row.created_at | str substring 0..10)
            users: $user_count
            tickets: $ticket_count
            last_ticket: (if ($row.last_ticket_date? | is-empty) { "never" } else { $row.last_ticket_date | str substring 0..10 })
            est_total_records: $est_total_records
        }
    }
    
    $enriched_tenants | table
}

# Inspect tenant data
def "main inspect" [
    tenant_id: string        # Tenant ID to inspect
    --environment: string = "local"  # Environment to use
] {
    print $"\nInspecting tenant: ($tenant_id)\n"
    
    # Get tenant info
    let tenant_query = "SELECT * FROM tenants WHERE tenant = '" + $tenant_id + "'"
    let tenant = query-sql $tenant_query --env-name $environment | first
    
    if ($tenant | is-empty) {
        print "Tenant not found!"
        exit 1
    }
    
    print $"Client: ($tenant.client_name)"
    print $"Created: ($tenant.created_at)"
    print "\nData breakdown:\n"
    
    # Get all tables with tenant column
    let tables_query = "
        SELECT 
            c.table_name,
            c.column_name as tenant_column
        FROM information_schema.columns c
        JOIN information_schema.tables t ON c.table_name = t.table_name 
            AND c.table_schema = t.table_schema
        WHERE c.column_name IN ('tenant', 'tenant_id')
            AND c.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name
    "
    
    let tables = query-sql $tables_query --env-name $environment
    
    # Count records in each table
    let counts = $tables | par-each { |table|
        let count_query = "SELECT COUNT(*) as count FROM " + $table.table_name + " WHERE " + $table.tenant_column + " = '" + $tenant_id + "'"
        
        try {
            let result = query-sql $count_query --env-name $environment | first
            let count = if ($result.count? | is-empty) { 0 } else { $result.count | into int }
            
            if $count > 0 {
                { table: $table.table_name, records: $count }
            } else {
                null
            }
        } catch {
            null
        }
    } | where {|item| $item != null } | sort-by records --reverse
    
    # Display results
    $counts | table
    
    print $"\nTables with data: ($counts | length)"
    print $"Estimated total records: ($counts | get records | math sum)"
}

# Cleanup tenant
def "main cleanup" [
    tenant_id: string           # Tenant ID to cleanup
    --environment: string = "local"     # Environment to use
    --execute                   # Actually delete (default is dry-run)
    --preserve-tenant           # Keep the tenant record itself
    --force                     # Skip confirmation prompts
] {
    let is_dry_run = not $execute
    
    print ("=" | fill -w 60)
    let mode = if $is_dry_run { "DRY RUN" } else { "*** ACTUAL DELETION ***" }
    print $"TENANT CLEANUP - ($mode)"
    print ("=" | fill -w 60)
    
    # Get tenant info
    let tenant_query = "SELECT * FROM tenants WHERE tenant = '" + $tenant_id + "'"
    let tenant = query-sql $tenant_query --env-name $environment | first
    
    if ($tenant | is-empty) {
        print "Tenant not found!"
        exit 1
    }
    
    print $"Tenant ID: ($tenant_id)"
    print $"Client: ($tenant.client_name)"
    print $"Created: ($tenant.created_at)"
    print $"Preserve tenant record: ($preserve_tenant)"
    print $"Environment: ($environment)"
    
    # Check if this looks like production data
    let activity_query = (
        "SELECT " +
        "(SELECT COUNT(*) FROM users WHERE tenant = '" + $tenant_id + "') as user_count, " +
        "(SELECT COUNT(*) FROM invoices WHERE tenant = '" + $tenant_id + "' AND created_at > NOW() - INTERVAL '30 days') as recent_invoices, " +
        "(SELECT COUNT(*) FROM tickets WHERE tenant = '" + $tenant_id + "' AND entered_at > NOW() - INTERVAL '7 days') as recent_tickets"
    )
    
    let activity = query-sql $activity_query --env-name $environment | first
    let user_count = $activity.user_count | into int
    let recent_invoices = $activity.recent_invoices | into int
    let recent_tickets = $activity.recent_tickets | into int
    
    let is_production = ($user_count > 20) or ($recent_invoices > 0) or ($recent_tickets > 5)
    
    if $is_production {
        print "\n*** WARNING: This appears to be an ACTIVE/PRODUCTION tenant! ***"
        print $"Users: ($user_count)"
        print $"Recent invoices \(30d\): ($recent_invoices)"
        print $"Recent tickets \(7d\): ($recent_tickets)"
        
        if (not $force) and (not $is_dry_run) {
            let answer = input "\nAre you SURE you want to delete this production tenant? (yes/no): "
            if $answer != "yes" {
                print "Cleanup cancelled."
                exit 0
            }
        }
    }
    
    if (not $is_dry_run) and (not $force) {
        let answer = input "\nThis will PERMANENTLY delete data. Continue? (yes/no): "
        if $answer != "yes" {
            print "Cleanup cancelled."
            exit 0
        }
    }
    
    print "\nStarting cleanup...\n"
    
    # Tables to delete from (in dependency order - most dependent first)
    # The order is critical due to foreign key constraints
    let tables = [
        # === LEVEL 1: Leaf tables with no dependencies ===
        # Workflow details
        "workflow_action_results" "workflow_event_attachments" "workflow_snapshots"
        "workflow_action_dependencies" "workflow_sync_points" "workflow_timers"
        "workflow_task_history" "workflow_form_schemas"
        
        # Task/project details
        "task_checklist_items" "project_task_dependencies" "task_resources"
        "project_ticket_links"
        
        # Invoice details
        "invoice_items" "invoice_annotations" "invoice_time_entries" "invoice_usage_records"
        "invoice_item_details" "invoice_item_fixed_details"
        
        # Time tracking
        "time_sheet_comments" "time_entries" "time_sheets"
        
        # Document details
        "document_block_content" "document_versions" "document_content"
        
        # Messages and comments
        "messages" "direct_messages" "comments"
        "gmail_processed_history" "email_processed_messages"
        
        # User related details
        "user_notification_preferences" "internal_notification_preferences" "user_preferences"
        "role_permissions" "user_roles"
        
        # Schedule and team
        "schedule_entry_assignees" "schedule_conflicts" "team_members"
        
        # Tags and resources
        "tag_mappings" "ticket_resources"
        
        # Logs and notifications
        "job_details" "audit_logs" "notification_logs" "internal_notifications"
        
        # Asset details
        "asset_maintenance_notifications" "asset_maintenance_history" "asset_service_history"
        "asset_ticket_associations" "asset_document_associations" "asset_relationships"
        "asset_history" "asset_associations"
        "workstation_assets" "server_assets" "network_device_assets" "mobile_device_assets" "printer_assets"
        
        # === LEVEL 2: Tables that depend on level 3+ ===
        # Billing details
        "credit_allocations" "credit_reconciliation_reports" "credit_tracking"
        "usage_tracking" "bucket_usage" "transactions"
        "client_contracts" "contract_line_service_rate_tiers" "contract_line_service_bucket_config"
        "contract_line_service_hourly_config" "contract_line_service_hourly_configs" "contract_line_service_usage_config"
        "contract_line_service_fixed_config" "contract_line_service_configuration" "contract_line_fixed_config"
        "service_rate_tiers" "contract_line_discounts" "discounts"
        "client_contract_lines" "client_billing_cycles" "client_billing_settings"
        "contract_line_services" "contract_line_mappings" "contracts"
        
        # Client details (must come before clients)
        "client_tax_rates" "client_tax_settings"
        "tenant_companies"
        
        # Project/task entities
        "project_tasks" "project_phases" "project_status_mappings"
        
        # Workflow entities
        "workflow_tasks" "workflow_executions" "workflow_events" "workflow_event_processing"
        "workflow_registration_versions" "workflow_triggers" "workflow_form_definitions"
        "workflow_task_definitions"
        
        # === LEVEL 3: Mid-level entities ===
        # Document associations must come before documents
        "document_associations"
        
        # Assets must come after asset details
        "asset_maintenance_schedules" "assets"
        
        # Contract Lines
        "contract_lines" "payment_methods"
        
        # Interactions must come BEFORE tickets (tickets reference interactions in some cases)
        "interactions" "interaction_types"
        
        # Schedule entries
        "schedule_entries"
        
        # Service catalog
        "service_catalog" "service_types" "service_categories"
        
        # Settings that might be referenced
        "approval_thresholds"
        
        # Conditional display rules must come BEFORE invoice_templates
        "conditional_display_rules"
        
        # === LEVEL 4: Core business entities ===
        # Invoice templates (after conditional_display_rules)
        "invoice_templates"
        
        # Invoices (after invoice_templates)
        "invoices"
        
        # Projects
        "projects"
        
        # External files and documents
        "external_files" "documents" "document_types"
        
        # Workflow templates
        "workflow_registrations" "workflow_templates" "workflow_template_categories"
        
        # === LEVEL 5: Tickets and related ===
        # Tickets MUST be deleted BEFORE categories, statuses, etc that it references
        # AND BEFORE client_locations that tickets reference via location_id
        "tickets"
        
        # === LEVEL 6: Client locations (referenced by tickets.location_id) ===
        # Must be deleted AFTER tickets
        "client_locations"
        
        # === LEVEL 6: Lookup tables referenced by tickets ===
        # These can only be deleted AFTER tickets
        "categories"
        "standard_statuses" "statuses"
        "priorities" "severities" "urgencies" "impacts"
        
        # === LEVEL 7: Boards (referenced by categories) ===
        # Boards must be deleted AFTER categories (renamed from channels)
        "boards"
        
        # === LEVEL 8: Breaking circular dependencies ===
        # There's a complex circular dependency:
        # - users.contact_id → contacts (with ON DELETE SET NULL that fails on NOT NULL constraint)
        # - contacts.client_id → clients
        # - clients.account_manager → users
        
        # Tax configuration (no dependencies on core entities)
        "tax_components" "tax_rates" "tax_regions"
        
        # Permissions and roles (must be deleted before users)
        "permissions" "roles" "teams"
        
        # The correct order to avoid constraint violations:
        # 1. Delete clients first (after NULLing account_manager)
        # 2. Delete contacts second (after NULLing client_id, before users that reference them)
        # 3. Delete users last (they have NOT NULL contact_id that references contacts)
        
        "clients"  # Delete clients FIRST (after NULLing account_manager references)
        "contacts"   # Delete contacts SECOND (after clients, before users that have NOT NULL contact_id)
        "users"      # Delete users LAST (they have NOT NULL contact_id → contacts)
        
        # === LEVEL 7: Configuration and settings ===
        # API and auth
        "api_keys" "portal_invitations" "password_reset_tokens"
        
        # Policies and resources
        "policies" "resources"
        
        # Email configuration
        "google_email_provider_config" "microsoft_email_provider_config"
        "email_provider_configs" "email_providers"
        
        # Storage configuration
        "storage_configurations" "storage_providers"
        
        # Templates and layouts
        "tenant_email_templates" "template_sections"
        "approval_levels"  # After approval_thresholds
        
        # Custom fields and attributes
        "attribute_definitions" "custom_fields"
        "layout_blocks" "tag_definitions" "custom_task_types"
        
        # Time period settings (tenant_time_period_settings must come BEFORE time_period_types)
        "tenant_time_period_settings"
        "time_periods" "time_period_types" "time_period_settings"
        
        # Other tenant settings
        "tenant_telemetry_settings"
        "tenant_external_entity_mappings" "telemetry_consent_log"
        "default_billing_settings" "notification_settings"
        "inbound_ticket_defaults" "user_type_rates" "next_number"
        "event_catalog" "provider_events"
        
        # Tenant settings last
        "tenant_settings"
    ]
    
    let config = get-db-config $environment
    let conn_str = build-connection-string $config
    
    mut total_deleted = 0
    mut tables_affected = 0
    
    # First, break circular dependencies by NULLing foreign keys
    if not $is_dry_run {
        print "Breaking circular dependencies..."
        
        # The circular dependency chain:
        # clients.account_manager_id → users.user_id
        # users.contact_id → contacts.contact_id (NOT NULL constraint!)
        # contacts.client_id → clients.client_id
        
        # Step 1: NULL out account_manager_id in clients to break clients → users dependency
        try {
            let null_query = "UPDATE clients SET account_manager_id = NULL WHERE tenant = '" + $tenant_id + "'"
            execute-sql $null_query --env-name $environment
            print "  Cleared account_manager_id references in clients"
        } catch {
            # Ignore if column doesn't exist or already NULL
        }
        
        # Step 2: NULL out client_id in contacts to break contacts → clients dependency
        try {
            let null_query = "UPDATE contacts SET client_id = NULL WHERE tenant = '" + $tenant_id + "'"
            execute-sql $null_query --env-name $environment
            print "  Cleared client_id references in contacts"
        } catch {
            # Ignore if column doesn't exist or already NULL
        }
        
        # Note: We cannot NULL users.contact_id because it has a NOT NULL constraint
        # Instead, we'll delete in the order: clients → contacts → users
        # This way contacts are deleted before users tries to reference them
    }
    
    # Delete from each table
    for table in $tables {
        # Check if table has tenant column
        let check_query = (
            "SELECT column_name " +
            "FROM information_schema.columns " +
            "WHERE table_name = '" + $table + "' " +
            "AND column_name IN ('tenant', 'tenant_id') " +
            "AND table_schema = 'public' " +
            "LIMIT 1"
        )
        
        let column_result = execute-sql $check_query --env-name $environment
        
        if ($column_result | length) > 0 {
            let column_name = $column_result | first
            
            # Count records
            let count_query = "SELECT COUNT(*) FROM " + $table + " WHERE " + $column_name + " = '" + $tenant_id + "'"
            let count_result = execute-sql $count_query --env-name $environment | first
            let count = if ($count_result | is-empty) { 0 } else { $count_result | into int }
            
            if $count > 0 {
                if $is_dry_run {
                    print $"  Would delete ($count) records from ($table)"
                } else {
                    let delete_query = "DELETE FROM " + $table + " WHERE " + $column_name + " = '" + $tenant_id + "'"
                    execute-sql $delete_query --env-name $environment
                    print $"  Deleted ($count) records from ($table)"
                }
                $total_deleted = $total_deleted + $count
                $tables_affected = $tables_affected + 1
            }
        }
    }
    
    # Handle tenant record
    if not $preserve_tenant {
        if $is_dry_run {
            print "  Would delete tenant record from tenants table"
        } else {
            let delete_tenant_query = "DELETE FROM tenants WHERE tenant = '" + $tenant_id + "'"
            execute-sql $delete_tenant_query --env-name $environment
            print "  Deleted tenant record from tenants table"
        }
        $total_deleted = $total_deleted + 1
        $tables_affected = $tables_affected + 1
    } else {
        print "  Preserving tenant record in tenants table (as requested)"
    }
    
    print ""
    print ("=" | fill -w 60)
    print "CLEANUP SUMMARY"
    print ("=" | fill -w 60)
    let mode_text = if $is_dry_run { "DRY RUN" } else { "ACTUAL DELETION" }
    print $"Mode: ($mode_text)"
    print $"Tenant: ($tenant_id) \(($tenant.client_name)\)"
    print $"Tables affected: ($tables_affected)"
    let action_text = if $is_dry_run { "to delete" } else { "deleted" }
    print $"Estimated total records ($action_text): ($total_deleted)"
    
    if $is_dry_run {
        print "\n*** This was a DRY RUN - no data was actually deleted ***"
        print "*** Add --execute flag to actually delete data ***"
    } else {
        print "\n*** Data has been PERMANENTLY DELETED ***"
    }
}

# Show help
def main [] {
    print "Tenant Cleanup Tool for Alga PSA\n"
    print "Commands:"
    print "  list                      List all tenants"
    print "  inspect <tenant-id>       Inspect tenant data"
    print "  cleanup <tenant-id>       Cleanup tenant (dry-run by default)"
    print ""
    print "Options:"
    print "  --environment <local|production>  Environment to use (default: local)"
    print "  --execute                         Actually delete data (for cleanup command)"
    print "  --preserve-tenant                 Keep the tenant record itself"
    print "  --force                           Skip confirmation prompts"
    print ""
    print "Examples:"
    print "  nu cli/cleanup-tenant.nu list"
    print "  nu cli/cleanup-tenant.nu list --environment production"
    print "  nu cli/cleanup-tenant.nu inspect 12345678-1234-1234-1234-123456789012"
    print "  nu cli/cleanup-tenant.nu cleanup 12345678-1234-1234-1234-123456789012"
    print "  nu cli/cleanup-tenant.nu cleanup 12345678-1234-1234-1234-123456789012 --execute"
    print ""
    print "Workflow:"
    print "  1. List tenants to identify test ones: nu cli/cleanup-tenant.nu list --environment production"
    print "  2. Inspect a tenant: nu cli/cleanup-tenant.nu inspect <id> --environment production"
    print "  3. Dry run first: nu cli/cleanup-tenant.nu cleanup <id> --environment production"
    print "  4. Execute if safe: nu cli/cleanup-tenant.nu cleanup <id> --environment production --execute"
}