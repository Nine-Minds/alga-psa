# Alga Development CLI

# --- Color Constants ---
let color_reset = (ansi reset)
let color_green = (ansi green)
let color_yellow = (ansi yellow)
let color_red = (ansi red)
let color_cyan = (ansi cyan)
# --- End Color Constants ---

# Find the project root directory by looking for key files
def find-project-root [] {
    let current_dir = pwd
    mut search_dir = $current_dir
    
    # Look for characteristic files that indicate project root
    let root_indicators = ["package.json", "docker-compose.yaml", "README.md", "cli"]
    
    # Search up the directory tree
    loop {
        # Check if all indicators exist in current directory
        let current_search_dir = $search_dir  # Copy to avoid capture issue
        let has_indicators = ($root_indicators | all { |indicator| 
            ($current_search_dir | path join $indicator | path exists)
        })
        
        if $has_indicators {
            return $search_dir
        }
        
        # Move up one directory
        let parent = ($search_dir | path dirname)
        
        # If we've reached the filesystem root, stop
        if $parent == $search_dir {
            error make { msg: $"($color_red)Could not find project root. Make sure you're running from within the alga-psa project directory.($color_reset)" }
        }
        
        $search_dir = $parent
    }
}


# Manage database migrations
def migrate [
    action: string # The migration action to perform: up, latest, down, or status
] {
    let project_root = find-project-root
    
    match $action {
        "up" => {
            print $"($color_cyan)Running next pending database migration...($color_reset)"
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd ($project_root | path join "server")
                npx knex migrate:up --knexfile knexfile.cjs --env migration | complete # Use migrate:up
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout # Keep knex output as is
                print $"($color_green)Migration 'up' completed successfully.($color_reset)"
            } else {
                print $"($color_red)($result.stderr)($color_reset)"
                error make { msg: $"($color_red)Migration 'up' failed($color_reset)", code: $result.exit_code }
            }
        }
        "latest" => { # Add separate case for 'latest'
            print $"($color_cyan)Running all pending database migrations...($color_reset)"
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd ($project_root | path join "server")
                npx knex migrate:latest --knexfile knexfile.cjs --env migration | complete # Use migrate:latest
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout # Keep knex output as is
                print $"($color_green)Migrations 'latest' completed successfully.($color_reset)"
            } else {
                print $"($color_red)($result.stderr)($color_reset)"
                error make { msg: $"($color_red)Migration 'latest' failed($color_reset)", code: $result.exit_code }
            }
        }
        "down" => {
            print $"($color_cyan)Reverting last database migration...($color_reset)"
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd ($project_root | path join "server")
                npx knex migrate:down --knexfile knexfile.cjs --env migration | complete
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout # Keep knex output as is
                print $"($color_green)Migration reverted successfully.($color_reset)"
            } else {
                print $"($color_red)($result.stderr)($color_reset)"
                error make { msg: $"($color_red)Migration revert failed($color_reset)", code: $result.exit_code }
            }
        }
        "status" => {
            print $"($color_cyan)Checking migration status...($color_reset)"
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd ($project_root | path join "server")
                npx knex migrate:status --knexfile knexfile.cjs --env migration | complete
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout # Keep knex output as is
                print $"($color_green)Migration status checked successfully.($color_reset)"
            } else {
                print $"($color_red)($result.stderr)($color_reset)"
                error make { msg: $"($color_red)Checking migration status failed($color_reset)", code: $result.exit_code }
            }
        }
        _ => {
            # This case should technically not be reachable due to the type annotation
            # but it's good practice to include it.
            error make { msg: $"($color_red)Unknown migration action: ($action)($color_reset)" }
        }
    }
}

# Load Database Environment Variables from server/.env
def load-db-env [] {
    let project_root = find-project-root
    let env_path = ($project_root | path join "server" ".env")
    if not ($env_path | path exists) {
        error make { msg: $"($color_red)Database environment file not found: ($env_path)($color_reset)" }
    }

    # Read, filter comments/empty lines, parse key=value
    open $env_path
    | lines
    | each { |line| $line | str trim } # Trim whitespace
    | where { |line| not ($line | str starts-with '#') and ($line | str length) > 0 } # Filter comments/empty
    | split column "=" -n 2 # Split into max 2 columns based on the first '='
    | rename key value # Rename columns for clarity
    | update key {|it| $it.key | str trim } # Trim whitespace from key
    | update value {|it| if ($it.value | is-empty) { "" } else { $it.value | str trim | str trim -c '"' | str trim -c "'" } } # Trim whitespace/quotes from value, handle empty
    | reduce -f {} { |item, acc| $acc | upsert $item.key $item.value } # Fold into a record
    # Select the CORRECT keys provided by the user
    | select DB_HOST DB_PORT DB_USER_ADMIN DB_NAME_SERVER DB_PASSWORD_ADMIN
}


# Update System Workflow Registration
# Reads a workflow definition file and updates the latest version in the database.
def update-workflow [
   workflow_name: string # The BASE name of the workflow (e.g., 'invoice-sync', 'qboCustomerSyncWorkflow'), without path or .ts extension
] {
   let project_root = find-project-root
   print $"($color_cyan)Updating system workflow registration for '($workflow_name)'...($color_reset)"

   # Construct file path (assuming .ts extension)
   let workflow_file = ($project_root | path join "server" "src" "lib" "workflows" $"($workflow_name).ts")

   # Check if file exists
   if not ($workflow_file | path exists) {
       error make { msg: $"($color_red)Workflow file not found: ($workflow_file)($color_reset)" }
   }

   # Read file content
   let file_content = open $workflow_file

   # Define the SQL query using psql variables
   # Updates the 'definition' of the most recently created version of the named system workflow
   let sql_update = "
   UPDATE system_workflow_registration_versions
   SET code = :'content' -- Store content as text
   WHERE version_id = (
       SELECT sv.version_id
       FROM system_workflow_registration_versions sv
       JOIN system_workflow_registrations sw ON sv.registration_id = sw.registration_id
       WHERE sw.name = :'workflow_name'
       ORDER BY sv.created_at DESC
       LIMIT 1
   );
   "

   # Load Database Environment Variables using the helper function
   let db_env = load-db-env

   print $"($color_cyan)Executing database update...($color_reset)"

   # Execute psql command using explicit connection params from loaded env
   let result = do {
       cd ($project_root | path join "server")
       with-env { PGPASSWORD: $db_env.DB_PASSWORD_ADMIN } {
           $sql_update | psql -h $db_env.DB_HOST -p $db_env.DB_PORT -U $db_env.DB_USER_ADMIN -d $db_env.DB_NAME_SERVER -v ON_ERROR_STOP=1 -v $"content=($file_content)" -v $"workflow_name=($workflow_name)" -f - | complete
       }
   }

   # Check result and print feedback
   if $result.exit_code == 0 {
       # Check if any rows were updated (psql might return 'UPDATE 0' or 'UPDATE 1')
       if ($result.stdout | str contains "UPDATE 1") {
            print $"($color_green)System workflow '($workflow_name)' updated successfully.($color_reset)"
       } else if ($result.stdout | str contains "UPDATE 0") {
            print $"($color_yellow)Warning: No matching system workflow named '($workflow_name)' found or no update needed.($color_reset)"
       } else {
            print $result.stdout # Print other potential output
            print $"($color_yellow)System workflow '($workflow_name)' update command executed, but result unclear.($color_reset)"
       }
   } else {
       print $"($color_red)($result.stderr)($color_reset)"
       error make { msg: $"($color_red)System workflow update failed($color_reset)", code: $result.exit_code }
   }
}
# Register or Add New Version for a System Workflow
# Creates the registration if it doesn't exist, then adds a new version
# based on the file content, marking it as the current version.
def register-workflow [
    workflow_name: string # The BASE name of the workflow (e.g., 'invoice-sync', 'qboCustomerSyncWorkflow'), without path or .ts extension
] {
    let project_root = find-project-root
    print $"($color_cyan)Registering/Versioning system workflow '($workflow_name)'...($color_reset)"

    # Construct file path
    let workflow_file = ($project_root | path join "server" "src" "lib" "workflows" $"($workflow_name).ts")
    if not ($workflow_file | path exists) {
        error make { msg: $"($color_red)Workflow file not found: ($workflow_file)($color_reset)" }
    }
    let file_content = open $workflow_file

    # Load Database Environment Variables using the helper function
    let db_env = load-db-env

    # --- Check if latest version already matches file content ---
    print $"($color_cyan)Checking current version in database...($color_reset)"
    let sql_check = "
    SELECT sv.code
    FROM system_workflow_registration_versions sv
    JOIN system_workflow_registrations sw ON sv.registration_id = sw.registration_id
    WHERE sw.name = :'workflow_name'
    ORDER BY sv.created_at DESC
    LIMIT 1;
    "
    let check_result = do {
        cd ($project_root | path join "server")
        with-env { PGPASSWORD: $db_env.DB_PASSWORD_ADMIN } {
            $sql_check | psql -h $db_env.DB_HOST -p $db_env.DB_PORT -U $db_env.DB_USER_ADMIN -d $db_env.DB_NAME_SERVER -v $"workflow_name=($workflow_name)" -t -A -f - | complete
        }
    }

    if $check_result.exit_code == 0 {
        let current_definition = ($check_result.stdout | str trim) # Trim potential trailing newline
        if $current_definition == $file_content {
            print $"($color_green)Workflow '($workflow_name)' is already up-to-date with the current file content. No changes made.($color_reset)"
            return
        } else {
            print $"($color_cyan)Current version differs or does not exist. Proceeding with registration/versioning...($color_reset)"
        }
    } else {
        # If the check fails (e.g., workflow not registered yet), proceed with registration
        print $"($color_yellow)Warning: Could not retrieve current workflow definition (Exit Code: ($check_result.exit_code)). Proceeding with registration/versioning...($color_reset)"
        print $"($color_red)($check_result.stderr)($color_reset)"
    }
    # --- End Check ---


    # Generate a version string (using timestamp for simplicity in dev)
    let new_version_string = (date now | format date '%Y%m%d%H%M%S%f')

    # Define the transactional SQL query
    # Uses CTEs for clarity and ensures atomicity with BEGIN/COMMIT
    let sql_transaction = "
    BEGIN;

    -- Step 1: Ensure registration exists and get its ID into a temporary table
    CREATE TEMP TABLE _tmp_reg_id (registration_id UUID) ON COMMIT DROP;

    WITH upsert_reg AS (
        INSERT INTO system_workflow_registrations (name, version, status)
        VALUES (:'workflow_name', :'new_version_string', 'draft')
        ON CONFLICT (name) DO UPDATE SET updated_at = now()
        RETURNING registration_id
    )
    INSERT INTO _tmp_reg_id (registration_id)
    SELECT registration_id FROM upsert_reg
    UNION ALL
    SELECT registration_id FROM system_workflow_registrations
    WHERE name = :'workflow_name' AND NOT EXISTS (SELECT 1 FROM upsert_reg LIMIT 1) -- Ensure this only runs if upsert_reg was empty (conflict occurred)
    LIMIT 1;

    -- Step 2: Unset existing 'is_current' flag for this registration
    UPDATE system_workflow_registration_versions
    SET is_current = false
    WHERE registration_id = (SELECT registration_id FROM _tmp_reg_id) AND is_current = true;

    -- Step 3: Insert the new version, marking it as current
    INSERT INTO system_workflow_registration_versions (registration_id, version, is_current, code)
    SELECT registration_id, :'new_version_string', true, :'content' -- Store content as text
    FROM _tmp_reg_id;
    -- RETURNING version_id; -- Not strictly needed for the rest of this transaction block

    -- Step 4: Update the main registration's version string and status
    UPDATE system_workflow_registrations
    SET
        version = :'new_version_string',
        status = 'active', -- Set to active once a version is added
        updated_at = now()
    WHERE registration_id = (SELECT registration_id FROM _tmp_reg_id);

    COMMIT;
    "

    print $"($color_cyan)Executing database transaction...($color_reset)"
 
    # Execute psql command using explicit connection params from loaded env
    let result = do {
        cd ($project_root | path join "server")
        with-env { PGPASSWORD: $db_env.DB_PASSWORD_ADMIN } {
            $sql_transaction | psql -h $db_env.DB_HOST -p $db_env.DB_PORT -U $db_env.DB_USER_ADMIN -d $db_env.DB_NAME_SERVER -v ON_ERROR_STOP=1 -v $"workflow_name=($workflow_name)" -v $"new_version_string=($new_version_string)" -v $"content=($file_content)" -f - | complete
        }
    }

    # Check result
    if $result.exit_code == 0 {
        let version_info = $"Version: ($new_version_string)"
        print $"($color_green)System workflow '($workflow_name)' registered/versioned successfully (($version_info)).($color_reset)"
    } else {
        print $"($color_red)($result.stderr)($color_reset)"
        # Note: psql might not output specific errors easily here if ON_ERROR_STOP is used
        error make { msg: $"($color_red)System workflow registration/versioning failed. Transaction rolled back.($color_reset)", code: $result.exit_code }
    }
}

# Start development environment with Docker Compose
def dev-up [
    --detached (-d) # Run in detached mode (background)
    --edition (-e): string = "ce" # Edition to start: ce (community) or ee (enterprise)
] {
    let project_root = find-project-root
    
    # Validate edition parameter
    if not ($edition in ["ce", "ee"]) {
        error make { msg: $"($color_red)Invalid edition '($edition)'. Must be 'ce' (community) or 'ee' (enterprise).($color_reset)" }
    }
    
    let edition_file = if $edition == "ce" { "docker-compose.prebuilt.ce.yaml" } else { "docker-compose.ee.yaml" }
    let base_file = if $edition == "ce" { "docker-compose.prebuilt.base.yaml" } else { "docker-compose.base.yaml" }
    let edition_name = if $edition == "ce" { "Community Edition" } else { "Enterprise Edition" }
    
    print $"($color_cyan)Starting development environment (($edition_name))...($color_reset)"
    print $"($color_cyan)Project root: ($project_root)($color_reset)"
    
    if $detached {
        let command = $"docker compose -f ($base_file) -f ($edition_file) --env-file server/.env up --build -d"
        print $"($color_yellow)Running: ($command)($color_reset)"
        
        let result = do {
            cd $project_root
            docker compose -f $base_file -f $edition_file --env-file server/.env up -d | complete
        }
        
        if $result.exit_code == 0 {
            print $"($color_green)Development environment (($edition_name)) started in background.($color_reset)"
            print $"($color_cyan)Access the application at: http://localhost:3000($color_reset)"
            print $"($color_cyan)View logs with: docker compose logs -f($color_reset)"
        } else {
            print $"($color_red)($result.stderr)($color_reset)"
            error make { msg: $"($color_red)Failed to start development environment($color_reset)", code: $result.exit_code }
        }
    } else {
        let command = $"docker compose -f ($base_file) -f ($edition_file) --env-file server/.env up"
        print $"($color_yellow)Running: ($command)($color_reset)"
        
        # Stream output directly without capturing
        cd $project_root
        docker compose -f $base_file -f $edition_file --env-file server/.env up --build
    }
}

# Stop development environment
def dev-down [] {
    let project_root = find-project-root
    print $"($color_cyan)Stopping development environment...($color_reset)"
    
    let result = do {
        cd $project_root
        docker compose down | complete
    }
    
    if $result.exit_code == 0 {
        print $result.stdout
        print $"($color_green)Development environment stopped.($color_reset)"
    } else {
        print $"($color_red)($result.stderr)($color_reset)"
        error make { msg: $"($color_red)Failed to stop development environment($color_reset)", code: $result.exit_code }
    }
}

# Create development environment for PR
def dev-env-create [
    pr_number: int     # GitHub PR number
    --branch: string   # Git branch (defaults to pr/pr_number)
    --edition: string = "ce"  # Edition: ce or ee
    --ai-enabled = false # Include AI automation
] {
    let project_root = find-project-root
    
    # Validate edition parameter
    if not ($edition in ["ce", "ee"]) {
        error make { msg: $"($color_red)Invalid edition '($edition)'. Must be 'ce' (community) or 'ee' (enterprise).($color_reset)" }
    }
    
    # Default branch name
    let git_branch = if ($branch | is-empty) { $"pr/($pr_number)" } else { $branch }
    let namespace = $"alga-pr-($pr_number)"
    
    print $"($color_cyan)Creating development environment for PR ($pr_number)...($color_reset)"
    print $"($color_cyan)Branch: ($git_branch)($color_reset)"
    print $"($color_cyan)Edition: ($edition)($color_reset)"
    print $"($color_cyan)AI Automation: ($ai_enabled)($color_reset)"
    print $"($color_cyan)Namespace: ($namespace)($color_reset)"
    
    # Check if environment already exists
    let existing_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $existing_check.exit_code == 0 {
        print $"($color_yellow)Warning: Environment for PR ($pr_number) already exists in namespace ($namespace)($color_reset)"
        print $"($color_yellow)Use 'dev-env-destroy ($pr_number)' to remove it first if you want to recreate it.($color_reset)"
        return
    }
    
    # Create temporary values file
    let temp_values_file = $"($project_root)/temp-values-pr-($pr_number).yaml"
    let edition_comment = if $edition == "ee" { "# Enterprise Edition settings" } else { "# Community Edition settings" }
    let image_name = $"harbor.nineminds.com/nineminds/alga-psa-($edition)"
    let values_content = $"
# Generated values for PR ($pr_number) development environment
devEnv:
  enabled: true
  prNumber: \"($pr_number)\"
  namespace: \"($namespace)\"
  repository:
    url: \"https://github.com/Nine-Minds/alga-psa.git\"
    branch: \"($git_branch)\"
  codeServer:
    enabled: true
  aiAutomation:
    enabled: ($ai_enabled)

server:
  image:
    name: \"($image_name)\"
    tag: \"latest\"

($edition_comment)"
    
    # Write temporary values file
    $values_content | save -f $temp_values_file
    
    try {
        # Deploy using Helm
        print $"($color_cyan)Deploying Helm chart...($color_reset)"
        let helm_result = do {
            cd $project_root
            helm upgrade --install $"alga-pr-($pr_number)" ./helm -f helm/values-dev-env.yaml -f $temp_values_file --create-namespace | complete
        }
        
        if $helm_result.exit_code != 0 {
            print $"($color_red)Helm deployment failed:($color_reset)"
            print $"($color_red)($helm_result.stderr)($color_reset)"
            error make { msg: $"($color_red)Failed to deploy development environment($color_reset)", code: $helm_result.exit_code }
        }
        
        print $helm_result.stdout
        print $"($color_green)Helm deployment completed successfully.($color_reset)"
        
        # Wait for deployments to be ready
        print $"($color_cyan)Waiting for deployments to be ready...($color_reset)"
        let wait_result = do {
            kubectl wait --for=condition=available --timeout=300s deployment -l app.kubernetes.io/instance=$"alga-pr-($pr_number)" -n $namespace | complete
        }
        
        if $wait_result.exit_code == 0 {
            print $"($color_green)All deployments are ready!($color_reset)"
            
            # Show environment status
            dev-env-status $pr_number
        } else {
            print $"($color_yellow)Warning: Some deployments may still be starting. Use 'dev-env-status ($pr_number)' to check progress.($color_reset)"
        }
        
    } catch { |err|
        print $"($color_red)Error during deployment: ($err.msg)($color_reset)"
    }
    
    # Clean up temporary files
    if ($temp_values_file | path exists) {
        rm $temp_values_file
    }
}

# List active development environments
def dev-env-list [] {
    print $"($color_cyan)Active development environments:($color_reset)"
    
    let namespaces_result = do {
        kubectl get namespaces -l type=dev-environment -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.labels.pr-number}{"\n"}{end}' | complete
    }
    
    if $namespaces_result.exit_code != 0 {
        print $"($color_red)Failed to list environments: ($namespaces_result.stderr)($color_reset)"
        return
    }
    
    let environments = ($namespaces_result.stdout | lines | where ($it | str trim | str length) > 0)
    
    if ($environments | length) == 0 {
        print $"($color_yellow)No active development environments found.($color_reset)"
        return
    }
    
    print "┌─────────────────────────────────────────────────────────────────┐"
    print "│ Namespace                │ PR #  │ Status                       │"
    print "├─────────────────────────────────────────────────────────────────┤"
    
    for env_line in $environments {
        let parts = ($env_line | split column "\t")
        let namespace = ($parts | get column1 | get 0)
        let pr_num = ($parts | get column2 -i | get 0? | default "Unknown")
        let status_result = do {
            kubectl get deployments -n $namespace -o jsonpath='{range .items[*]}{.status.readyReplicas}{" "}{.status.replicas}{"\n"}{end}' | complete
        }
        
        let status = if $status_result.exit_code == 0 {
            let ready_total = ($status_result.stdout | lines | each { |line|
                if ($line | str trim | str length) > 0 {
                    let parts = ($line | split row " ")
                    let ready = ($parts | get 0? | default "0" | if ($in == "") { "0" } else { $in } | into int)
                    let total = ($parts | get 1? | default "0" | if ($in == "") { "0" } else { $in } | into int)
                    { ready: $ready, total: $total }
                }
            } | compact)
            
            let total_ready = ($ready_total | each { |x| $x.ready } | math sum)
            let total_deployments = ($ready_total | each { |x| $x.total } | math sum)
            
            if $total_ready == $total_deployments {
                "Ready"
            } else {
                $"($total_ready)/($total_deployments) Ready"
            }
        } else {
            "Error"
        }
        
        print $"│ ($namespace | fill -w 24) │ ($pr_num | fill -w 5) │ ($status | fill -w 28) │"
    }
    
    print "└─────────────────────────────────────────────────────────────────┘"
}

# Connect to development environment
def dev-env-connect [
    pr_number: int     # PR number to connect to
    --port-forward     # Setup port forwarding
    --code-server      # Open code server in browser
] {
    let namespace = $"alga-pr-($pr_number)"
    
    # Check if environment exists
    let env_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $env_check.exit_code != 0 {
        print $"($color_red)Environment for PR ($pr_number) not found.($color_reset)"
        print $"($color_yellow)Use 'dev-env-list' to see available environments.($color_reset)"
        return
    }
    
    print $"($color_cyan)Connecting to development environment for PR ($pr_number)...($color_reset)"
    
    if $port_forward {
        print $"($color_cyan)Setting up port forwarding...($color_reset)"
        print $"($color_yellow)This will run in foreground. Press Ctrl+C to stop.($color_reset)"
        
        # Port forward multiple services
        print $"($color_cyan)Port forwarding setup:($color_reset)"
        print $"  Code Server: http://localhost:8080"
        print $"    Password: alga-dev"
        print $"  PSA App:     http://localhost:3001"
        
        # Start port forwarding in background and keep main process alive
        print $"($color_cyan)Starting port forwarding processes...($color_reset)"
        
        # Start processes using bash for proper backgrounding
        bash -c $"kubectl port-forward -n ($namespace) svc/dev-env-pr-($pr_number)-alga-dev-code-server 8080:8080 &"
        bash -c $"kubectl port-forward -n ($namespace) svc/dev-env-pr-($pr_number)-alga-dev 3001:3000 &"
        
        # Give processes time to start
        sleep 2sec
        print $"($color_green)Port forwarding active!($color_reset)"
        
        # Wait for user to stop
        input "Press Enter to stop port forwarding..."
        
        # Kill all kubectl port-forward processes
        bash -c $"pkill -f 'kubectl port-forward.*dev-env-pr-($pr_number)'"
        print $"($color_cyan)Port forwarding stopped.($color_reset)"
    } else {
        dev-env-status $pr_number
    }
    
    if $code_server {
        # Get ingress URL and open in browser
        let ingress_result = do {
            kubectl get ingress -n $namespace -o jsonpath='{.items[0].spec.rules[0].host}' | complete
        }
        
        if $ingress_result.exit_code == 0 and ($ingress_result.stdout | str trim | str length) > 0 {
            let url = $"https://($ingress_result.stdout)"
            print $"($color_cyan)Opening code server: ($url)($color_reset)"
            
            # Try to open in browser (works on most systems)
            try {
                if (which open | length) > 0 {
                    open $url
                } else if (which xdg-open | length) > 0 {
                    xdg-open $url
                } else {
                    print $"($color_yellow)Could not auto-open browser. Please visit: ($url)($color_reset)"
                }
            } catch {
                print $"($color_yellow)Could not auto-open browser. Please visit: ($url)($color_reset)"
            }
        } else {
            print $"($color_yellow)Could not determine ingress URL. Use 'dev-env-status ($pr_number)' to get connection details.($color_reset)"
        }
    }
}

# Destroy development environment
def dev-env-destroy [
    pr_number: int     # PR number to destroy
    --force            # Force deletion without confirmation
] {
    let namespace = $"alga-pr-($pr_number)"
    
    # Check if environment exists
    let env_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $env_check.exit_code != 0 {
        print $"($color_yellow)Environment for PR ($pr_number) not found or already destroyed.($color_reset)"
        return
    }
    
    if not $force {
        print $"($color_yellow)This will permanently destroy the development environment for PR ($pr_number).($color_reset)"
        print $"($color_yellow)All data in the environment will be lost.($color_reset)"
        let confirmation = (input $"Type 'yes' to confirm destruction: ")
        
        if $confirmation != "yes" {
            print $"($color_cyan)Destruction cancelled.($color_reset)"
            return
        }
    }
    
    print $"($color_cyan)Destroying development environment for PR ($pr_number)...($color_reset)"
    
    # Remove Helm release
    let helm_result = do {
        helm uninstall $"alga-pr-($pr_number)" -n $namespace | complete
    }
    
    if $helm_result.exit_code != 0 {
        print $"($color_yellow)Warning: Helm uninstall had issues: ($helm_result.stderr)($color_reset)"
    } else {
        print $"($color_green)Helm release removed successfully.($color_reset)"
    }
    
    # Force delete namespace to ensure cleanup
    print $"($color_cyan)Cleaning up namespace...($color_reset)"
    let namespace_result = do {
        kubectl delete namespace $namespace --timeout=60s | complete
    }
    
    if $namespace_result.exit_code == 0 {
        print $"($color_green)Development environment for PR ($pr_number) destroyed successfully.($color_reset)"
    } else {
        print $"($color_yellow)Warning: Namespace cleanup had issues. The environment may still be partially present.($color_reset)"
        print $"($color_yellow)You may need to manually clean up resources in namespace ($namespace).($color_reset)"
    }
}

# Get environment status and URLs
def dev-env-status [
    pr_number?: int    # Optional PR number, shows all if omitted
] {
    if ($pr_number | is-empty) {
        dev-env-list
        return
    }
    
    let namespace = $"alga-pr-($pr_number)"
    
    # Check if environment exists
    let env_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $env_check.exit_code != 0 {
        print $"($color_red)Environment for PR ($pr_number) not found.($color_reset)"
        print $"($color_yellow)Use 'dev-env-list' to see available environments.($color_reset)"
        return
    }
    
    print $"($color_cyan)Development Environment Status - PR ($pr_number)($color_reset)"
    print "═══════════════════════════════════════════════════════"
    
    # Get deployment status
    print $"($color_cyan)Deployments:($color_reset)"
    let deployments_result = do {
        kubectl get deployments -n $namespace -o custom-columns="NAME:.metadata.name,READY:.status.readyReplicas,TOTAL:.status.replicas,AGE:.metadata.creationTimestamp" --no-headers | complete
    }
    
    if $deployments_result.exit_code == 0 {
        ($deployments_result.stdout | lines | each { |line|
            if ($line | str trim | str length) > 0 {
                print $"  ($line)"
            }
        })
    } else {
        print $"  ($color_red)Error getting deployment status($color_reset)"
    }
    
    print ""
    
    # Get service URLs
    print $"($color_cyan)Service URLs:($color_reset)"
    let ingress_result = do {
        kubectl get ingress -n $namespace -o jsonpath='{range .items[*]}{.spec.rules[*].host}{"\n"}{end}' | complete
    }
    
    if $ingress_result.exit_code == 0 {
        let hosts = ($ingress_result.stdout | lines | each { |line| $line | str trim } | where { |x| ($x | str length) > 0 })
        
        for host in $hosts {
            let url = $"https://($host)"
            if ($host | str contains "code") {
                print $"  Code Server:     ($url)"
            } else if ($host | str contains "ai-api") {
                print $"  AI API:          ($url)"
            } else if ($host | str contains "ai") {
                print $"  AI Web:          ($url)"
            } else {
                print $"  PSA App:         ($url)"
            }
        }
    } else {
        print $"  ($color_yellow)No ingress URLs found($color_reset)"
    }
    
    print ""
    
    # Port forward instructions
    print $"($color_cyan)Local Access - Port Forward:($color_reset)"
    print $"  Run: dev-env-connect ($pr_number) --port-forward"
    print $"  Then access:"
    print $"    Code Server: http://localhost:8080 - password: alga-dev"
    print $"    PSA App:     http://localhost:3001"
    
    print ""
    print $"($color_cyan)Management Commands:($color_reset)"
    print $"  Connect:  dev-env-connect ($pr_number) [--port-forward] [--code-server]"
    print $"  Destroy:  dev-env-destroy ($pr_number) [--force]"
}

# Build Docker image for specified edition
def build-image [
    edition: string,         # Edition to build (ce or ee) 
    --tag: string = "latest" # Docker tag to use
    --push                   # Push to registry after building
] {
    if not ($edition in ["ce", "ee"]) {
        error make { msg: $"($color_red)Edition must be 'ce' or 'ee'($color_reset)" }
    }
    
    print $"($color_cyan)Building ($edition | str upcase) Docker image...($color_reset)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name and build context
    let image_name = $"harbor.nineminds.com/nineminds/alga-psa-($edition)"
    let full_tag = $"($image_name):($tag)"
    
    # Build the image
    print $"($color_yellow)Building: ($full_tag)($color_reset)"
    
    if $edition == "ee" {
        # EE build includes everything
        let result = (docker build --platform linux/amd64 -f server/Dockerfile -t $full_tag . | complete)
        if $result.exit_code != 0 {
            print $"($color_red)Build failed:($color_reset)"
            print $result.stderr
            error make { msg: "Docker build failed" }
        }
    } else {
        # CE build excludes EE directory
        let result = (docker build --platform linux/amd64 -f server/Dockerfile -t $full_tag --build-arg EXCLUDE_EE=true . | complete)
        if $result.exit_code != 0 {
            print $"($color_red)Build failed:($color_reset)"
            print $result.stderr
            error make { msg: "Docker build failed" }
        }
    }
    
    print $"($color_green)Successfully built: ($full_tag)($color_reset)"
    
    if $push {
        print $"($color_yellow)Pushing: ($full_tag)($color_reset)"
        let push_result = (docker push $full_tag | complete)
        if $push_result.exit_code != 0 {
            print $"($color_red)Push failed:($color_reset)"
            print $push_result.stderr
            error make { msg: "Docker push failed" }
        }
        print $"($color_green)Successfully pushed: ($full_tag)($color_reset)"
    }
}

# Build Docker images for both CE and EE editions
def build-all-images [
    --tag: string = "latest" # Docker tag to use
    --push                   # Push to registry after building
] {
    print $"($color_cyan)Building all edition Docker images...($color_reset)"
    
    # Build CE edition
    if $push {
        build-image "ce" --tag $tag --push
    } else {
        build-image "ce" --tag $tag
    }
    
    # Build EE edition  
    if $push {
        build-image "ee" --tag $tag --push
    } else {
        build-image "ee" --tag $tag
    }
    
    print $"($color_green)All builds completed successfully!($color_reset)"
}

# Alga Development CLI Entry Point
# Handles command-line arguments to run migration or workflow actions.
def --wrapped main [
   ...args: string   # All arguments and flags as strings
] {
   let command = ($args | get 0? | default null)
   
   # Handle help flags
   if $command in ["--help", "-h", "help"] {
       print $"($color_cyan)Alga Dev CLI($color_reset)"
       print "Usage:"
       print "  nu main.nu migrate <action>"
       print "    Action: up, latest, down, status"
       print "    Example: nu main.nu migrate latest"
       print ""
       print "  nu main.nu -- dev-up [--detached] [--edition ce|ee]  # Start development environment"
       print "  nu main.nu dev-down               # Stop development environment"
       print ""
       print "  nu main.nu dev-env-create <pr_number> [--branch <branch>] [--edition ce|ee] [--ai-enabled]"
       print "    Create on-demand development environment for PR"
       print "  nu main.nu dev-env-list           # List active development environments"
       print "  nu main.nu dev-env-connect <pr_number> [--port-forward] [--code-server]"
       print "    Connect to development environment"
       print "  nu main.nu dev-env-destroy <pr_number> [--force]"
       print "    Destroy development environment"
       print "  nu main.nu dev-env-status [<pr_number>]"
       print "    Get environment status and URLs"
       print ""
       print "Note: Use '--' before dev-up when using flags to prevent Nu from parsing them:"
       print "  nu main.nu -- dev-up --edition ee --detached"
       print ""
       print "  nu main.nu update-workflow <base_workflow_name> # Update latest version definition"
       print "    Example: nu main.nu update-workflow invoice-sync"
       print ""
       print "  nu main.nu register-workflow <base_workflow_name> # Add new version (creates registration if needed)"
       print "    Example: nu main.nu register-workflow customer-sync"
       print ""
       print "  nu main.nu build-image <edition> [--tag <tag>] [--push]"
       print "    Build Docker image for specified edition (ce|ee)"
       print "    Example: nu main.nu build-image ce --tag latest --push"
       print "  nu main.nu build-all-images [--tag <tag>] [--push]"
       print "    Build Docker images for both CE and EE editions"
       print "    Example: nu main.nu build-all-images --tag latest --push"
       print ""
       print "Alternatively, source the script ('source main.nu') and run commands directly:"
       print "  dev-env-create 123 --branch my-feature"
       print "  dev-env-list"
       print "  dev-env-connect 123 --code-server"
       return
   }
   
   # Basic usage check
   if $command == null {
       print $"($color_cyan)Alga Dev CLI($color_reset)"
       print "Usage:"
       print "  nu main.nu migrate <action>"
       print "    Action: up, latest, down, status"
       print "    Example: nu main.nu migrate latest"
       print ""
       print "  nu main.nu -- dev-up [--detached] [--edition ce|ee]  # Start development environment"
       print "  nu main.nu dev-down               # Stop development environment"
       print ""
       print "  nu main.nu dev-env-create <pr_number> [--branch <branch>] [--edition ce|ee] [--ai-enabled]"
       print "    Create on-demand development environment for PR"
       print "  nu main.nu dev-env-list           # List active development environments"
       print "  nu main.nu dev-env-connect <pr_number> [--port-forward] [--code-server]"
       print "    Connect to development environment"
       print "  nu main.nu dev-env-destroy <pr_number> [--force]"
       print "    Destroy development environment"
       print "  nu main.nu dev-env-status [<pr_number>]"
       print "    Get environment status and URLs"
       print ""
       print "Note: Use '--' before dev-up when using flags to prevent Nu from parsing them:"
       print "  nu main.nu -- dev-up --edition ee --detached"
       print ""
       print "  nu main.nu update-workflow <base_workflow_name> # Update latest version definition"
       print "    Example: nu main.nu update-workflow invoice-sync"
       print ""
       print "  nu main.nu register-workflow <base_workflow_name> # Add new version (creates registration if needed)"
       print "    Example: nu main.nu register-workflow customer-sync"
       print ""
       print "  nu main.nu build-image <edition> [--tag <tag>] [--push]"
       print "    Build Docker image for specified edition (ce|ee)"
       print "    Example: nu main.nu build-image ce --tag latest --push"
       print "  nu main.nu build-all-images [--tag <tag>] [--push]"
       print "    Build Docker images for both CE and EE editions"
       print "    Example: nu main.nu build-all-images --tag latest --push"
       print "\nAlternatively, source the script ('source main.nu') and run commands directly:"
       print "  migrate <action>"
       print "  dev-up [--detached] [--edition ce|ee]"
       print "  dev-down"
       print "  update-workflow <workflow_name>"
       print "  register-workflow <workflow_name>"
       print "  dev-env-create <pr_number> [options]"
       print "  dev-env-list, dev-env-connect, dev-env-destroy, dev-env-status"
       return # Exit if arguments are missing
   }

   # Route command
   match $command {
       "migrate" => {
           let action = ($args | get 1? | default null)
           if $action == null {
               error make { msg: $"($color_red)migrate command requires an action: up, latest, down, status($color_reset)" }
           }
           # Validate the migrate action
           if not ($action in ["up", "latest", "down", "status"]) {
                error make { msg: $"($color_red)Invalid migrate action '($action)'. Must be one of: up, latest, down, status($color_reset)" }
           }
           # Call the migrate command
           migrate $action
       }
       "dev-up" => {
           # Parse flags from args (skip the command itself)
           let command_args = ($args | skip 1)
           let detached = ($command_args | any { |arg| $arg == "--detached" or $arg == "-d" })
           let edition_idx = ($command_args | enumerate | where {|item| $item.item == "--edition" or $item.item == "-e"} | get 0?.index | default null)
           let edition = if $edition_idx != null { 
               ($command_args | get ($edition_idx + 1) | default "ce")
           } else { 
               "ce" 
           }
           
           if $detached {
               dev-up --detached --edition $edition
           } else {
               dev-up --edition $edition
           }
       }
       "dev-down" => {
           dev-down
       }
       "dev-env-create" => {
           let pr_number = ($args | get 1? | default null)
           if $pr_number == null {
               error make { msg: $"($color_red)dev-env-create command requires a PR number($color_reset)" }
           }
           
           # Parse flags
           let command_args = ($args | skip 2)
           let branch_idx = ($command_args | enumerate | where {|item| $item.item == "--branch"} | get 0?.index | default null)
           let branch = if $branch_idx != null { 
               ($command_args | get ($branch_idx + 1) | default "")
           } else { 
               "" 
           }
           
           let edition_idx = ($command_args | enumerate | where {|item| $item.item == "--edition"} | get 0?.index | default null)
           let edition = if $edition_idx != null { 
               ($command_args | get ($edition_idx + 1) | default "ce")
           } else { 
               "ce" 
           }
           
           let ai_enabled = not ($command_args | any { |arg| $arg == "--no-ai" })
           
           # Call the dev-env-create command
           if ($branch | str length) > 0 {
               dev-env-create ($pr_number | into int) --branch $branch --edition $edition --ai-enabled=$ai_enabled
           } else {
               dev-env-create ($pr_number | into int) --edition $edition --ai-enabled=$ai_enabled
           }
       }
       "dev-env-list" => {
           dev-env-list
       }
       "dev-env-connect" => {
           let pr_number = ($args | get 1? | default null)
           if $pr_number == null {
               error make { msg: $"($color_red)dev-env-connect command requires a PR number($color_reset)" }
           }
           
           # Parse flags
           let command_args = ($args | skip 2)
           let port_forward = ($command_args | any { |arg| $arg == "--port-forward" })
           let code_server = ($command_args | any { |arg| $arg == "--code-server" })
           
           # Call the dev-env-connect command
           if $port_forward and $code_server {
               dev-env-connect ($pr_number | into int) --port-forward --code-server
           } else if $port_forward {
               dev-env-connect ($pr_number | into int) --port-forward
           } else if $code_server {
               dev-env-connect ($pr_number | into int) --code-server
           } else {
               dev-env-connect ($pr_number | into int)
           }
       }
       "dev-env-destroy" => {
           let pr_number = ($args | get 1? | default null)
           if $pr_number == null {
               error make { msg: $"($color_red)dev-env-destroy command requires a PR number($color_reset)" }
           }
           
           # Parse flags
           let command_args = ($args | skip 2)
           let force = ($command_args | any { |arg| $arg == "--force" })
           
           # Call the dev-env-destroy command
           if $force {
               dev-env-destroy ($pr_number | into int) --force
           } else {
               dev-env-destroy ($pr_number | into int)
           }
       }
       "dev-env-status" => {
           let pr_number = ($args | get 1? | default null)
           if $pr_number != null {
               dev-env-status ($pr_number | into int)
           } else {
               dev-env-status
           }
       }
       "update-workflow" => {
           let workflow_name = ($args | get 1? | default null)
           if $workflow_name == null {
               error make { msg: $"($color_red)update-workflow command requires a workflow name($color_reset)" }
           }
           # Call the update-workflow command
           update-workflow $workflow_name
       }
       "register-workflow" => {
           let workflow_name = ($args | get 1? | default null)
           if $workflow_name == null {
               error make { msg: $"($color_red)register-workflow command requires a workflow name($color_reset)" }
           }
           # Call the register-workflow command
           register-workflow $workflow_name
       }
       "build-image" => {
           let edition = ($args | get 1? | default null)
           if $edition == null {
               error make { msg: $"($color_red)build-image command requires an edition (ce|ee)($color_reset)" }
           }
           
           # Parse flags
           let command_args = ($args | skip 2)
           let tag_idx = ($command_args | enumerate | where {|item| $item.item == "--tag"} | get 0?.index | default null)
           let tag = if $tag_idx != null { ($command_args | get ($tag_idx + 1) | default "latest") } else { "latest" }
           let push = ($command_args | any { |arg| $arg == "--push" })
           
           # Call the build-image command
           if $push {
               build-image $edition --tag $tag --push
           } else {
               build-image $edition --tag $tag
           }
       }
       "build-all-images" => {
           # Parse flags
           let command_args = ($args | skip 1)
           let tag_idx = ($command_args | enumerate | where {|item| $item.item == "--tag"} | get 0?.index | default null)
           let tag = if $tag_idx != null { ($command_args | get ($tag_idx + 1) | default "latest") } else { "latest" }
           let push = ($command_args | any { |arg| $arg == "--push" })
           
           # Call the build-all-images command
           if $push {
               build-all-images --tag $tag --push
           } else {
               build-all-images --tag $tag
           }
       }
       _ => {
           error make { msg: $"($color_red)Unknown command: '($command)'. Must be 'migrate', 'dev-up', 'dev-down', 'dev-env-*', 'update-workflow', 'register-workflow', 'build-image', or 'build-all-images'.($color_reset)" }
       }
   }
}