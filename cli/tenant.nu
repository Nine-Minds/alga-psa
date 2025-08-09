#!/usr/bin/env nu

# Tenant management commands for Alga PSA

# Create a new tenant
export def create-tenant [
    tenant_name: string      # Name of the tenant company
    admin_email: string      # Email for the admin user
    --first-name: string = "Admin"    # Admin user's first name
    --last-name: string = "User"       # Admin user's last name
    --company-name: string = ""        # Company name (defaults to tenant name)
    --password: string = ""            # Admin password (generated if not provided)
    --seed-onboarding = true           # Run onboarding seeds after creation
    --skip-onboarding = false          # Set onboarding_skipped flag to true in tenant_settings
] {
    print $"($env.ALGA_COLOR_CYAN)Creating new tenant: ($tenant_name)($env.ALGA_COLOR_RESET)"
    
    # Set company name to tenant name if not provided
    let company_name = if $company_name == "" { $tenant_name } else { $company_name }
    
    # Get the project root
    let project_root = (find-project-root)
    
    # Run the tenant creation
    print $"($env.ALGA_COLOR_YELLOW)→ Creating tenant and admin user...($env.ALGA_COLOR_RESET)"
    
    # Use the shared tenant creation module
    let result = (
        cd $"($project_root)/server"; npm run --silent create-tenant -- --tenant $"($tenant_name)" --email $"($admin_email)" --firstName $"($first_name)" --lastName $"($last_name)" --companyName $"($company_name)" --password $"($password)"
        | complete
    )
    
    if $result.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)✗ Failed to create tenant($env.ALGA_COLOR_RESET)"
        print $"Error: ($result.stderr)"
        return
    }
    
    # Extract tenant ID and password from output
    let output = $result.stdout
    let tenant_id_line = ($output | lines | where { |line| $line | str contains "Tenant ID:" } | first)
    # Remove brackets from tenant ID
    let tenant_id = ($tenant_id_line | split column ":" | get column2 | first | str trim | str replace "[" "" | str replace "]" "")
    let temp_password = if $password == "" {
        let password_line = ($output | lines | where { |line| $line | str contains "Temporary Password:" } | first)
        ($password_line | split column ":" | get column2 | first | str trim)
    } else {
        $password
    }
    
    print $"($env.ALGA_COLOR_GREEN)✓ Tenant created successfully!($env.ALGA_COLOR_RESET)"
    print $"  Tenant ID: ($tenant_id)"
    print $"  Admin Email: ($admin_email)"
    if $password == "" {
        print $"  Temporary Password: ($temp_password)"
    }
    
    # Create tenant_settings record
    print $"\n($env.ALGA_COLOR_YELLOW)→ Creating tenant settings...($env.ALGA_COLOR_RESET)"
    print $"  Debug: Tenant ID = ($tenant_id)"
    
    let settings_sql = if $skip_onboarding {
        "INSERT INTO tenant_settings (tenant, onboarding_skipped, onboarding_completed, created_at, updated_at) VALUES (?, true, false, NOW(), NOW()) ON CONFLICT (tenant) DO UPDATE SET onboarding_skipped = true, updated_at = NOW()"
    } else {
        "INSERT INTO tenant_settings (tenant, onboarding_skipped, onboarding_completed, created_at, updated_at) VALUES (?, false, false, NOW(), NOW()) ON CONFLICT (tenant) DO NOTHING"
    }
    
    let settings_result = (
        cd $"($project_root)/server"; node scripts/run-sql.cjs migration $settings_sql $tenant_id
        | complete
    )
    
    if $settings_result.exit_code == 0 {
        if $skip_onboarding {
            print $"($env.ALGA_COLOR_GREEN)✓ Tenant settings created with onboarding skipped($env.ALGA_COLOR_RESET)"
        } else {
            print $"($env.ALGA_COLOR_GREEN)✓ Tenant settings created($env.ALGA_COLOR_RESET)"
        }
    } else {
        print $"($env.ALGA_COLOR_YELLOW)⚠ Could not create tenant settings($env.ALGA_COLOR_RESET)"
        # Try to debug the error
        print $"Debug: ($settings_result.stderr)"
    }
    
    # Run onboarding seeds if requested
    if $seed_onboarding {
        print $"\n($env.ALGA_COLOR_YELLOW)→ Running onboarding seeds...($env.ALGA_COLOR_RESET)"
        seed-tenant-onboarding $tenant_id
    }
    
    print $"\n($env.ALGA_COLOR_GREEN)✓ Tenant setup complete!($env.ALGA_COLOR_RESET)"
    print $"  Login URL: http://localhost:3000"
    print $"  Email: ($admin_email)"
    if $password == "" {
        print $"  Password: ($temp_password)"
    }
}

# Seed a tenant with onboarding data
export def seed-tenant-onboarding [
    tenant_id: string    # The tenant ID to seed
] {
    print $"($env.ALGA_COLOR_CYAN)Seeding onboarding data for tenant: ($tenant_id)($env.ALGA_COLOR_RESET)"
    
    # Get the project root
    let project_root = (find-project-root)
    
    # Run all seeds from the onboarding directory
    print $"($env.ALGA_COLOR_YELLOW)→ Running all onboarding seeds...($env.ALGA_COLOR_RESET)"
    
    # Create a temporary knexfile that points to the onboarding directory
    let temp_knexfile_content = "
const baseConfig = require('./knexfile.cjs');
module.exports = {
  ...baseConfig,
  migration: {
    ...baseConfig.migration,
    seeds: {
      directory: './seeds/dev/onboarding',
      loadExtensions: ['.cjs', '.js']
    }
  }
};"
    
    # Write the temporary knexfile
    let temp_knexfile_path = $"($project_root)/server/knexfile.onboarding.cjs"
    $temp_knexfile_content | save -f $temp_knexfile_path
    
    # Run the seeds
    let result = (
        cd $"($project_root)/server"; with-env {TENANT_ID: $tenant_id} { npx knex seed:run --knexfile knexfile.onboarding.cjs --env migration }
        | complete
    )
    
    # Clean up the temporary file
    rm -f $temp_knexfile_path
    
    if $result.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)✗ Failed to run onboarding seeds($env.ALGA_COLOR_RESET)"
        print $"Error: ($result.stderr)"
        return
    }
    
    print $"($env.ALGA_COLOR_GREEN)✓ All onboarding seeds completed($env.ALGA_COLOR_RESET)"
    
    print $"\n($env.ALGA_COLOR_GREEN)✓ Onboarding seeds completed!($env.ALGA_COLOR_RESET)"
}

# List all tenants
export def list-tenants [] {
    print $"($env.ALGA_COLOR_CYAN)Listing all tenants($env.ALGA_COLOR_RESET)\n"
    
    # Get the project root
    let project_root = (find-project-root)
    
    # Query the database for tenants  
    let sql = "SELECT t.tenant, t.company_name, t.email, t.created_at, ts.onboarding_completed, ts.onboarding_skipped FROM tenants t LEFT JOIN tenant_settings ts ON t.tenant = ts.tenant ORDER BY t.created_at DESC"
    let result = (
        cd $"($project_root)/server"; node scripts/run-sql.cjs migration $sql 2>/dev/null
        | complete
    )
    
    if $result.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)✗ Failed to list tenants($env.ALGA_COLOR_RESET)"
        print $"Error: ($result.stderr)"
        return
    }
    
    # Parse and display results
    let tenants = ($result.stdout | from json)
    
    if ($tenants | length) == 0 {
        print "No tenants found."
        return
    }
    
    # Display as a table
    $tenants | table
}

# Delete a tenant (use with caution!)
export def delete-tenant [
    tenant_id: string    # The tenant ID to delete
    --force = false          # Skip confirmation
] {
    if not $force {
        print $"($env.ALGA_COLOR_YELLOW)⚠️  WARNING: This will permanently delete the tenant and all associated data!($env.ALGA_COLOR_RESET)"
        let confirm = (input $"Are you sure you want to delete tenant ($tenant_id)? (yes/no): ")
        
        if $confirm != "yes" {
            print "Deletion cancelled."
            return
        }
    }
    
    print $"($env.ALGA_COLOR_RED)Deleting tenant: ($tenant_id)($env.ALGA_COLOR_RESET)"
    
    # Get the project root
    let project_root = (find-project-root)
    
    # Use the rollback function from the tenant creation module
    let result = (
        cd $"($project_root)/server"; npm run --silent rollback-tenant -- --tenantId $"($tenant_id)"
        | complete
    )
    
    if $result.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)✗ Failed to delete tenant($env.ALGA_COLOR_RESET)"
        print $"Error: ($result.stderr)"
        return
    }
    
    print $"($env.ALGA_COLOR_GREEN)✓ Tenant deleted successfully($env.ALGA_COLOR_RESET)"
}