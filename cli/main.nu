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

# Create development environment for branch
# 
# Environment variables for AI automation (read from .env file or shell environment):
#   CUSTOM_OPENAI_API_KEY: Required - API key for LLM provider (e.g., OpenRouter key)
#   CUSTOM_OPENAI_BASE_URL: Optional - API endpoint (default: https://openrouter.ai/api/v1)
#   CUSTOM_OPENAI_MODEL: Optional - Model name (default: google/gemini-2.5-flash-preview-05-20)
#
def dev-env-create [
    branch: string     # Git branch name
    --edition: string = "ce"  # Edition: ce or ee
    --use-latest = false # Use 'latest' tag instead of unique tag
    --checkout = true  # Checkout the branch locally
    --from-tag: string = "" # Deploy from existing image tag instead of building
] {
    let project_root = find-project-root
    
    # Validate edition parameter
    if not ($edition in ["ce", "ee"]) {
        error make { msg: $"($color_red)Invalid edition '($edition)'. Must be 'ce' (community) or 'ee' (enterprise).($color_reset)" }
    }
    
    # Check for mutually exclusive options
    if ($from_tag | str length) > 0 and $use_latest {
        error make { msg: $"($color_red)Cannot use both --from-tag and --use-latest. Choose one or the other.($color_reset)" }
    }
    
    # Sanitize branch name for Kubernetes namespace (lowercase, alphanumeric and hyphens only)
    # First replace slashes with hyphens, then clean up any other special characters
    let sanitized_branch = ($branch | str replace -a "/" "-" | str downcase | str replace -a "[^a-z0-9-]" "-" | str replace -r "^-+|-+$" "" | str replace -r "-+" "-")
    let namespace = $"alga-dev-($sanitized_branch)"
    
    # Checkout the branch if requested
    if $checkout {
        print $"($color_cyan)Checking out branch: ($branch)($color_reset)"
        let checkout_result = do {
            cd $project_root
            git checkout $branch | complete
        }
        
        if $checkout_result.exit_code != 0 {
            # Try to fetch and checkout if branch doesn't exist locally
            print $"($color_yellow)Branch not found locally, fetching from remote...($color_reset)"
            let fetch_result = do {
                cd $project_root
                git fetch origin $branch | complete
            }
            
            if $fetch_result.exit_code == 0 {
                let checkout_retry = do {
                    cd $project_root
                    git checkout -b $branch origin/$branch | complete
                }
                
                if $checkout_retry.exit_code != 0 {
                    print $"($color_yellow)Warning: Could not checkout branch ($branch). Continuing with current branch.($color_reset)"
                }
            } else {
                print $"($color_yellow)Warning: Branch ($branch) not found in remote. Continuing with current branch.($color_reset)"
            }
        }
    }
    
    # Find available ports for external access
    print $"($color_cyan)Finding available ports for external access...($color_reset)"
    
    # Function to find a free port
    def find-free-port [start_port: int] {
        mut port = $start_port
        mut found = false
        
        while not $found and $port < 65535 {
            # Copy mutable variable to avoid capture issue
            let current_port = $port
            
            # Check if port is in use
            let check_result = do { 
                bash -c $"nc -z localhost ($current_port) 2>/dev/null" | complete
            }
            
            if $check_result.exit_code != 0 {
                # Port is free
                $found = true
            } else {
                $port = $port + 1
            }
        }
        
        if $found { $port } else { 0 }
    }
    
    # Find ports for each service
    let app_port = find-free-port 30000
    let code_server_port = find-free-port ($app_port + 1)
    let code_app_port = find-free-port ($code_server_port + 1)
    let ai_web_port = find-free-port ($code_app_port + 1)
    
    if $app_port == 0 or $code_server_port == 0 or $code_app_port == 0 or $ai_web_port == 0 {
        error make { msg: $"($color_red)Could not find available ports for services($color_reset)" }
    }
    
    print $"($color_green)Assigned external ports:($color_reset)"
    print $"  Main App:     ($app_port)"
    print $"  Code Server:  ($code_server_port)"
    print $"  Code App:     ($code_app_port)"
    print $"  AI Web:       ($ai_web_port)"
    
    # Determine image tag based on options
    let image_tag = if ($from_tag | str length) > 0 {
        # Use the provided tag
        print $"($color_cyan)Using existing image tag: ($from_tag)($color_reset)"
        $from_tag
    } else if $use_latest {
        # Use latest tag
        "latest"
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"dev-($timestamp)"
        }
    }
    
    # Build image only if --from-tag is not specified
    if ($from_tag | str length) == 0 {
        print $"($color_cyan)Building image before deployment...($color_reset)"
        if $use_latest {
            build-image $edition --use-latest --push
        } else {
            build-image $edition --tag $image_tag --push
        }
    } else {
        print $"($color_cyan)Skipping build - using existing image with tag: ($from_tag)($color_reset)"
    }
    
    print $"($color_cyan)Creating development environment for branch: ($branch)($color_reset)"
    print $"($color_cyan)Sanitized name: ($sanitized_branch)($color_reset)"
    print $"($color_cyan)Edition: ($edition)($color_reset)"
    print $"($color_cyan)AI Automation: enabled($color_reset)"
    print $"($color_cyan)Namespace: ($namespace)($color_reset)"
    print $"($color_cyan)Image Tag: ($image_tag)($color_reset)"
    
    # Check if environment already exists
    let existing_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $existing_check.exit_code == 0 {
        # Check if namespace is in Terminating state
        let namespace_status = do {
            kubectl get namespace $namespace -o jsonpath='{.status.phase}' | complete
        }
        
        if $namespace_status.exit_code == 0 and ($namespace_status.stdout | str trim) == "Terminating" {
            print $"($color_yellow)Warning: Namespace ($namespace) is stuck in Terminating state.($color_reset)"
            print $"($color_cyan)Attempting to force cleanup...($color_reset)"
            
            # Force cleanup the stuck namespace
            let force_cleanup = do {
                kubectl delete namespace $namespace --grace-period=0 --force | complete
            }
            
            if $force_cleanup.exit_code == 0 {
                print $"($color_green)Stuck namespace cleaned up. Proceeding with creation...($color_reset)"
                sleep 5sec  # Give it a moment to fully clear
            } else {
                print $"($color_red)Failed to cleanup stuck namespace. Manual intervention required.($color_reset)"
                print $"($color_yellow)Try running: kubectl delete namespace ($namespace) --grace-period=0 --force($color_reset)"
                return
            }
        } else {
            print $"($color_yellow)Warning: Environment for branch ($branch) already exists in namespace ($namespace)($color_reset)"
            print $"($color_yellow)Use 'dev-env-destroy ($branch)' to remove it first if you want to recreate it.($color_reset)"
            return
        }
    }
    
    # Create temporary values file (replace slashes with dashes in filename)
    let safe_filename = ($branch | str replace -a "/" "-")
    let temp_values_file = $"($project_root)/temp-values-($safe_filename).yaml"
    let edition_comment = if $edition == "ee" { "# Enterprise Edition settings" } else { "# Community Edition settings" }
    let image_name = $"harbor.nineminds.com/nineminds/alga-psa-($edition)"
    
    # Load environment variables from user's home .env file if it exists
    let home_env_file = ($nu.home-path | path join ".env")
    if ($home_env_file | path exists) {
        print $"($color_cyan)Loading environment variables from ($home_env_file)...($color_reset)"
        let env_vars = (open $home_env_file 
            | lines 
            | each { |line| $line | str trim } 
            | where { |line| not ($line | str starts-with '#') and ($line | str length) > 0 and ($line | str contains '=') }
            | split column "=" -n 2 
            | rename key value
            | reduce -f {} { |item, acc| $acc | upsert $item.key $item.value })
        
        # Set environment variables from .env file if they're not already set
        $env_vars | items { |key, value|
            if ($env | get -i $key | is-empty) {
                load-env { ($key): $value }
            }
        }
    }

    # Get LLM configuration from environment variables
    let custom_openai_api_key = ($env.CUSTOM_OPENAI_API_KEY? | default "")
    let custom_openai_base_url = ($env.CUSTOM_OPENAI_BASE_URL? | default "https://openrouter.ai/api/v1")
    let custom_openai_model = ($env.CUSTOM_OPENAI_MODEL? | default "google/gemini-2.5-flash-preview-05-20")
    
    # Show warning if API key is not set
    if ($custom_openai_api_key | str length) == 0 {
        print $"($color_yellow)Warning: CUSTOM_OPENAI_API_KEY environment variable not set. AI automation may not work.($color_reset)"
        print $"($color_yellow)Set the environment variable in your .env file or export CUSTOM_OPENAI_API_KEY=your-key-here($color_reset)"
    }
    
    let values_content = $"
# Generated values for branch ($branch) development environment
devEnv:
  enabled: true
  branch: \"($branch)\"
  sanitizedBranch: \"($sanitized_branch)\"
  namespace: \"($namespace)\"
  repository:
    url: \"https://github.com/Nine-Minds/alga-psa.git\"
    branch: \"($branch)\"
  codeServer:
    enabled: true
  aiAutomation:
    enabled: true
  # External port configuration
  externalPorts:
    app: ($app_port)
    codeServer: ($code_server_port)
    codeApp: ($code_app_port)
    aiWeb: ($ai_web_port)

server:
  image:
    name: \"($image_name)\"
    tag: \"($image_tag)\"
  pullPolicy: Always  # Force pull to avoid cache issues

# LLM Configuration
config:
  llm:
    customOpenaiApiKey: \"($custom_openai_api_key)\"
    customOpenaiBaseUrl: \"($custom_openai_base_url)\"
    customOpenaiModel: \"($custom_openai_model)\"

($edition_comment)"
    
    # Write temporary values file
    $values_content | save -f $temp_values_file
    
    try {
        # Deploy using Helm (namespace will be created by template)
        print $"($color_cyan)Deploying Helm chart...($color_reset)"
        let helm_result = do {
            cd $project_root
            helm upgrade --install $"alga-dev-($sanitized_branch)" ./helm -f helm/values-dev-env.yaml -f $temp_values_file -n $namespace --create-namespace | complete
        }
        
        # Check for actual deployment failures (ignore benign warnings/messages)
        let has_real_error = if $helm_result.exit_code != 0 {
            # Check if stderr contains actual errors vs just warnings
            let stderr_content = ($helm_result.stderr | str downcase)
            let is_namespace_exists_only = ($stderr_content | str contains 'already exists')
            let has_warnings = ($stderr_content | str contains 'warning:')
            let has_errors = ($stderr_content | str contains 'error:')
            let is_warnings_only = ($has_warnings and not $has_errors)
            
            # Only treat as real error if it's not just namespace exists or warnings
            not ($is_namespace_exists_only or $is_warnings_only)
        } else { false }
        
        if $has_real_error {
            print $"($color_red)Helm deployment failed:($color_reset)"
            print $"($color_red)($helm_result.stderr)($color_reset)"
            error make { msg: $"($color_red)Failed to deploy development environment($color_reset)", code: $helm_result.exit_code }
        } else if $helm_result.exit_code != 0 {
            # Helm deployment had issues but resources are deployed - try upgrade to trigger hooks
            print $"($color_yellow)Initial deployment had issues, attempting upgrade to ensure hooks run...($color_reset)"
            let upgrade_result = do {
                cd $project_root
                helm upgrade $"alga-dev-($sanitized_branch)" ./helm -f helm/values-dev-env.yaml -f $temp_values_file -n $namespace | complete
            }
            
            if $upgrade_result.exit_code == 0 {
                print $"($color_green)Upgrade successful - hooks should have run for database initialization.($color_reset)"
            } else {
                print $"($color_yellow)Warning: Upgrade also had issues. Database may not be initialized.($color_reset)"
            }
        }
        
        # Show warnings but don't treat as errors
        if $helm_result.exit_code != 0 and not $has_real_error {
            print $"($color_yellow)Helm completed with warnings - ignoring:($color_reset)"
            # Filter out the file permission warnings which are just noise
            let filtered_stderr = ($helm_result.stderr | lines | where { |line| 
                (not ($line | str contains 'Kubernetes configuration file is'))
            } | where { |line|
                (not ($line | str contains 'deprecated since'))
            } | where { |line|
                (($line | str trim | str length) > 0)
            })
            if ($filtered_stderr | length) > 0 {
                $filtered_stderr | each { |line| print $"  ($line)" }
            }
        }
        
        print $helm_result.stdout
        print $"($color_green)Helm deployment completed successfully.($color_reset)"
        
        # Wait for deployments to be ready
        print $"($color_cyan)Waiting for deployments to be ready...($color_reset)"
        let wait_result = do {
            kubectl wait --for=condition=available --timeout=300s deployment -l app.kubernetes.io/instance=$"alga-dev-($sanitized_branch)" -n $namespace | complete
        }
        
        if $wait_result.exit_code == 0 {
            print $"($color_green)All deployments are ready!($color_reset)"
            
            # Show environment status
            dev-env-status $branch
        } else {
            print $"($color_yellow)Warning: Some deployments may still be starting. Use 'dev-env-status ($branch)' to check progress.($color_reset)"
        }
        
    } catch { |err|
        print $"($color_red)Error during deployment: ($err)($color_reset)"
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
        kubectl get namespaces -l type=dev-environment -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.labels.branch}{"\n"}{end}' | complete
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
    
    print "┌──────────────────────────────────────────────────────────────────────────┐"
    print "│ Namespace                │ Branch               │ Status                 │"
    print "├──────────────────────────────────────────────────────────────────────────┤"
    
    for env_line in $environments {
        let parts = ($env_line | split column "\t")
        let namespace = ($parts | get column1 | get 0)
        let branch = ($parts | get column2 -i | get 0? | default "Unknown")
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
            
            let total_ready = if ($ready_total | is-empty) { 0 } else { ($ready_total | get ready | math sum) }
            let total_deployments = if ($ready_total | is-empty) { 0 } else { ($ready_total | get total | math sum) }
            
            if $total_ready == $total_deployments {
                "Ready"
            } else {
                $"($total_ready)/($total_deployments) Ready"
            }
        } else {
            "Error"
        }
        
        print $"│ ($namespace | fill -w 24) │ ($branch | fill -w 20) │ ($status | fill -w 22) │"
    }
    
    print "└──────────────────────────────────────────────────────────────────────────┘"
}

# Connect to development environment
def dev-env-connect [
    branch: string     # Branch name to connect to
] {
    # Sanitize branch name for namespace lookup
    let sanitized_branch = ($branch | str replace -a "/" "-" | str downcase | str replace -a "[^a-z0-9-]" "-" | str replace -r "^-+|-+$" "" | str replace -r "-+" "-")
    let namespace = $"alga-dev-($sanitized_branch)"
    
    # Check if environment exists
    let env_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $env_check.exit_code != 0 {
        print $"($color_red)Environment for branch ($branch) not found.($color_reset)"
        print $"($color_yellow)Use 'dev-env-list' to see available environments.($color_reset)"
        return
    }
    
    print $"($color_cyan)Connecting to development environment for branch: ($branch)($color_reset)"
    print $"($color_cyan)Setting up port forwarding...($color_reset)"
    print $"($color_yellow)This will run in foreground. Press Ctrl+C to stop.($color_reset)"
        
        # Get the external ports from the deployment
        print $"($color_cyan)Retrieving assigned external ports...($color_reset)"
        
        # Get ports from configmap
        let ports_result = do {
            kubectl get configmap -n $namespace $"alga-dev-($sanitized_branch)-external-ports" -o json | complete
        }
        
        let use_random_ports = if $ports_result.exit_code != 0 {
            print $"($color_yellow)Warning: Could not retrieve external ports from ConfigMap($color_reset)"
            print $"($color_yellow)This environment was created before external port assignment was added.($color_reset)"
            print $"($color_yellow)Using random port assignment for backward compatibility.($color_reset)"
            true
        } else { false }
        
        if $use_random_ports {
            # Fallback to random ports for older environments
            print $"($color_cyan)Starting port forwarding with random ports...($color_reset)"
            
            # Start processes with random port assignment
            bash -c $"kubectl port-forward -n ($namespace) svc/alga-dev-($sanitized_branch)-code-server --address=127.0.0.1 0:8080 > /tmp/pf-code-server-($sanitized_branch).log 2>&1 &"
            bash -c $"kubectl port-forward -n ($namespace) svc/alga-dev-($sanitized_branch) --address=127.0.0.1 0:3000 > /tmp/pf-main-app-($sanitized_branch).log 2>&1 &"
            bash -c $"kubectl port-forward -n ($namespace) svc/alga-dev-($sanitized_branch)-code-server --address=127.0.0.1 0:3000 > /tmp/pf-code-app-($sanitized_branch).log 2>&1 &"
            
            # Give processes time to start
            sleep 3sec
            
            # Parse port assignments from logs
            let code_server_port = do {
                let log = (cat $"/tmp/pf-code-server-($sanitized_branch).log" | complete)
                if $log.exit_code == 0 {
                    let lines = ($log.stdout | lines | where { |line| $line | str contains "Forwarding from" })
                    if ($lines | length) > 0 {
                        ($lines | first | parse "Forwarding from 127.0.0.1:{port} -> 8080" | get 0?.port | default "unknown")
                    } else { "pending" }
                } else { "error" }
            }
            
            let app_port = do {
                let log = (cat $"/tmp/pf-main-app-($sanitized_branch).log" | complete)
                if $log.exit_code == 0 {
                    let lines = ($log.stdout | lines | where { |line| $line | str contains "Forwarding from" })
                    if ($lines | length) > 0 {
                        ($lines | first | parse "Forwarding from 127.0.0.1:{port} -> 3000" | get 0?.port | default "unknown")
                    } else { "pending" }
                } else { "error" }
            }
            
            let code_app_port = do {
                let log = (cat $"/tmp/pf-code-app-($sanitized_branch).log" | complete)
                if $log.exit_code == 0 {
                    let lines = ($log.stdout | lines | where { |line| $line | str contains "Forwarding from" })
                    if ($lines | length) > 0 {
                        ($lines | first | parse "Forwarding from 127.0.0.1:{port} -> 3000" | get 0?.port | default "unknown")
                    } else { "pending" }
                } else { "error" }
            }
            
            print $"($color_cyan)Port forwarding setup:($color_reset)"
            print $"  Code Server:        http://localhost:($code_server_port)"
            print $"    Password: alga-dev"
            print $"  PSA App \(main\):     http://localhost:($app_port)"
            print $"  PSA App \(in code\):  http://localhost:($code_app_port)"
        } else {
            # Parse the ConfigMap data
            let configmap_data = ($ports_result.stdout | from json)
            let ports_data = $configmap_data.data
            
            let app_port = ($ports_data.app | into int)
            let code_server_port = ($ports_data.codeServer | into int)
            let code_app_port = ($ports_data.codeApp | into int)
            let ai_web_port = ($ports_data.aiWeb | into int)
            
            print $"($color_green)Using assigned ports:($color_reset)"
            print $"  Main App:     ($app_port)"
            print $"  Code Server:  ($code_server_port)"
            print $"  Code App:     ($code_app_port)"
            print $"  AI Web:       ($ai_web_port)"
            
            # Start port forwarding processes with assigned ports
            print $"($color_cyan)Starting port forwarding processes...($color_reset)"
            
            # Start processes using bash for proper backgrounding with specific ports
            bash -c $"kubectl port-forward -n ($namespace) svc/alga-dev-($sanitized_branch)-code-server --address=127.0.0.1 ($code_server_port):8080 > /tmp/pf-code-server-($sanitized_branch).log 2>&1 &"
            bash -c $"kubectl port-forward -n ($namespace) svc/alga-dev-($sanitized_branch) --address=127.0.0.1 ($app_port):3000 > /tmp/pf-main-app-($sanitized_branch).log 2>&1 &"
            bash -c $"kubectl port-forward -n ($namespace) svc/alga-dev-($sanitized_branch)-code-server --address=127.0.0.1 ($code_app_port):3000 > /tmp/pf-code-app-($sanitized_branch).log 2>&1 &"
            bash -c $"kubectl port-forward -n ($namespace) svc/alga-dev-($sanitized_branch)-ai-nginx --address=127.0.0.1 ($ai_web_port):8080 > /tmp/pf-ai-web-($sanitized_branch).log 2>&1 &"
            
            # Give processes time to start
            sleep 2sec
            
            # Check if port forwarding started successfully
            let pf_check = do {
                bash -c $"ps aux | grep -E 'kubectl port-forward.*alga-dev-($sanitized_branch)' | grep -v grep | wc -l" | complete
            }
            
            if ($pf_check.stdout | str trim | into int) < 4 {
                print $"($color_yellow)Warning: Some port forwarding processes may not have started properly($color_reset)"
                print "Checking logs..."
                
                # Show any errors from log files
                for log_file in [
                    $"/tmp/pf-code-server-($sanitized_branch).log"
                    $"/tmp/pf-main-app-($sanitized_branch).log"
                    $"/tmp/pf-code-app-($sanitized_branch).log"
                    $"/tmp/pf-ai-web-($sanitized_branch).log"
                ] {
                    if ($log_file | path exists) {
                        let content = (open $log_file)
                        if ($content | str contains "error") {
                            print $"($color_red)Errors in ($log_file):($color_reset)"
                            print $content
                        }
                    }
                }
            }
            
            # Display the URLs
            print $"($color_cyan)Port forwarding setup:($color_reset)"
            print $"  Code Server:        http://localhost:($code_server_port)"
            print $"    Password: alga-dev"
            print $"  PSA App \(main\):     http://localhost:($app_port)"
            print $"  PSA App \(in code\):  http://localhost:($code_app_port)"
            print $"  AI Web:             http://localhost:($ai_web_port)"
        }
        
        
        print $"($color_green)Port forwarding active!($color_reset)"
        
        # Wait for user to stop
        input "Press Enter to stop port forwarding..."
        
        # Kill all kubectl port-forward processes
        bash -c $"pkill -f 'kubectl port-forward.*alga-dev-($sanitized_branch)'"
        
        # Clean up log files
        rm -f $"/tmp/pf-code-server-($sanitized_branch).log"
        rm -f $"/tmp/pf-main-app-($sanitized_branch).log" 
        rm -f $"/tmp/pf-code-app-($sanitized_branch).log"
        rm -f $"/tmp/pf-ai-web-($sanitized_branch).log"
        
        print $"($color_cyan)Port forwarding stopped.($color_reset)"
}

# Destroy development environment
def dev-env-destroy [
    branch: string     # Branch name to destroy
    --force            # Force deletion without confirmation
] {
    # Sanitize branch name for namespace lookup
    let sanitized_branch = ($branch | str replace -a "/" "-" | str downcase | str replace -a "[^a-z0-9-]" "-" | str replace -r "^-+|-+$" "" | str replace -r "-+" "-")
    let namespace = $"alga-dev-($sanitized_branch)"

    # Helper to get all ai-api pods in the namespace
    def get-ai-pods [] {
        let pods_by_label = do {
            kubectl get pods -n $namespace -l 'app.kubernetes.io/component=ai-automation-api' -o jsonpath='{.items[*].metadata.name}' --ignore-not-found | complete
        }

        let pods_by_name = do {
            kubectl get pods -n $namespace -o jsonpath='{.items[*].metadata.name}' --ignore-not-found | complete
        }

        let pods1 = if $pods_by_label.exit_code == 0 and not ($pods_by_label.stdout | is-empty) {
            $pods_by_label.stdout | str trim | split row ' '
        } else {
            []
        }

        let pods2 = if $pods_by_name.exit_code == 0 and not ($pods_by_name.stdout | is-empty) {
            $pods_by_name.stdout | str trim | split row ' ' | where {|it| $it | str contains "ai-api"}
        } else {
            []
        }

        $pods1 | append $pods2 | uniq
    }
    
    # Check if environment exists
    let env_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $env_check.exit_code != 0 {
        print $"($color_yellow)Environment for branch ($branch) not found or already destroyed.($color_reset)"
        return
    }
    
    if not $force {
        print $"($color_yellow)This will permanently destroy the development environment for branch ($branch).($color_reset)"
        print $"($color_yellow)All data in the environment will be lost.($color_reset)"
        let confirmation = (input $"Type 'yes' to confirm destruction: ")
        
        if $confirmation != "yes" {
            print $"($color_cyan)Destruction cancelled.($color_reset)"
            return
        }
    }
    
    print $"($color_cyan)Destroying development environment for branch: ($branch)...($color_reset)"
    
    # Step 1: Kill any stuck hook jobs first
    print $"($color_cyan)1. Cleaning up stuck hook jobs...($color_reset)"
    let stuck_jobs = do {
        kubectl get jobs -n $namespace -o jsonpath='{.items[*].metadata.name}' | complete
    }
    
    if $stuck_jobs.exit_code == 0 and ($stuck_jobs.stdout | str trim | str length) > 0 {
        let job_names = ($stuck_jobs.stdout | str trim | split row ' ')
        for job in $job_names {
            if ($job | str trim | str length) > 0 {
                print $"  Deleting job: ($job)"
                kubectl delete job $job -n $namespace --timeout=10s --force --grace-period=0 | complete
            }
        }
    } else {
        print $"  No stuck jobs found"
    }
    
    # Step 2: Force stop ai-api pods specifically (known to cause stuck namespaces)
    # Step 2: Scale down and remove ai-api resources to prevent them from getting stuck
    print $"($color_cyan)2. Scaling down ai-api deployment...($color_reset)"
    let ai_api_deployments = do {
        kubectl get deployment -n $namespace -l 'app.kubernetes.io/component=ai-automation-api' -o jsonpath='{.items[*].metadata.name}' --ignore-not-found | complete
    }

    if $ai_api_deployments.exit_code == 0 and not ($ai_api_deployments.stdout | is-empty) {
        let deployment_names = ($ai_api_deployments.stdout | str trim | split row ' ')
        for deployment in $deployment_names {
            if ($deployment | str trim | str length) > 0 {
                print $"  Scaling down deployment: ($deployment)"
                kubectl scale deployment $deployment --replicas=0 -n $namespace --timeout=30s | complete
            }
        }
    } else {
        print $"  No ai-api deployment found to scale down."
    }

    # Now, wait for the pods to terminate
    print $"($color_cyan)Waiting for ai-api pods to terminate...($color_reset)"
    mut wait_retries = 0
    while $wait_retries < 30 { # Wait for up to 60 seconds
        let remaining_pods = (get-ai-pods)
        if ($remaining_pods | is-empty) {
            print $"\n($color_green)All targeted ai-api pods have been terminated.($color_reset)"
            break
        } else {
            let remaining_str = ($remaining_pods | str join ", ")
            print -n $"\r  Waiting... remaining: ($remaining_str)"
            sleep 2sec
            $wait_retries = $wait_retries + 1
        }
    }
    if $wait_retries >= 30 {
        print $"\n($color_yellow)Warning: Pods did not terminate gracefully. Forcing deletion...($color_reset)"
        let remaining_pods = (get-ai-pods)
        if not ($remaining_pods | is-empty) {
            for pod in $remaining_pods {
                if ($pod | str trim | str length) > 0 {
                    print $"    Force deleting pod: ($pod)"
                    kubectl delete pod $pod -n $namespace --force --grace-period=0 | complete
                }
            }
            sleep 5sec # Give it a moment after force deletion
        }
    }
    
    # Step 3: Check for other stuck resources and handle them
    print $"($color_cyan)3. Checking for other stuck resources...($color_reset)"
    
    # Check for stuck pods
    let stuck_pods = do {
        kubectl get pods -n $namespace --field-selector=status.phase!=Running,status.phase!=Succeeded | complete
    }
    let has_terminating = ($stuck_pods.stdout | str contains 'Terminating')
    let has_pending = ($stuck_pods.stdout | str contains 'Pending')
    if $stuck_pods.exit_code == 0 and ($has_terminating or $has_pending) {
        print $"  Found stuck pods, force deleting..."
        kubectl delete pods --all -n $namespace --force --grace-period=0 | complete
    }
    
    # Step 4: Remove PV finalizers if stuck
    print $"($color_cyan)4. Checking for stuck persistent volumes...($color_reset)"
    let stuck_pvs = do {
        kubectl get pv | grep $namespace | awk '{print $1}' | complete
    }
    
    if $stuck_pvs.exit_code == 0 and ($stuck_pvs.stdout | str trim | str length) > 0 {
        let pv_names = ($stuck_pvs.stdout | lines | where { |line| ($line | str trim | str length) > 0 })
        for pv_name in $pv_names {
            print $"  Checking PV finalizers: ($pv_name)"
            # Try to patch finalizers to empty array to unstick the PV
            kubectl patch pv ($pv_name | str trim) -p '{\"metadata\":{\"finalizers\":null}}' --type=merge | complete
        }
    } else {
        print $"  No stuck persistent volumes found"
    }
    
    # Step 5: Find and remove Helm release - check where it actually exists
    print $"($color_cyan)5. Locating and removing Helm release...($color_reset)"
    let release_name = $"alga-dev-($sanitized_branch)"
    
    # Check if release exists in the environment namespace
    let helm_check_ns = do {
        helm status $release_name -n $namespace | complete
    }
    
    # Check if release exists in default namespace
    let helm_check_default = do {
        helm status $release_name -n default | complete
    }
    
    if $helm_check_ns.exit_code == 0 {
        print $"  Found release in ($namespace), removing..."
        let helm_result = do {
            helm uninstall $release_name -n $namespace --timeout=60s --no-hooks --cascade=background | complete
        }
        
        if $helm_result.exit_code == 0 {
            print $"  ($color_green)Helm release removed successfully from ($namespace).($color_reset)"
        } else {
            print $"  ($color_yellow)Warning: Helm uninstall had issues, trying force cleanup...($color_reset)"
            # Force delete the release by removing finalizers
            helm uninstall $release_name -n $namespace --timeout=30s --no-hooks | complete
        }
    } else if $helm_check_default.exit_code == 0 {
        print $"  Found release in default namespace, removing..."
        let helm_result = do {
            helm uninstall $release_name -n default --timeout=60s --no-hooks --cascade=background | complete
        }
        
        if $helm_result.exit_code == 0 {
            print $"  ($color_green)Helm release removed successfully from default namespace.($color_reset)"
        } else {
            print $"  ($color_yellow)Warning: Helm uninstall had issues, trying force cleanup...($color_reset)"
            # Force delete the release by removing finalizers
            helm uninstall $release_name -n default --timeout=30s --no-hooks | complete
        }
    } else {
        print $"  No Helm release found for ($release_name) in either namespace."
    }
    
    # Step 6: Clean up remaining resources systematically
    print $"($color_cyan)6. Cleaning up remaining resources...($color_reset)"
    
    # Delete all resources in the namespace first
    print $"  Deleting all workload resources..."
    kubectl delete all --all -n $namespace --timeout=30s | complete
    
    print $"  Deleting persistent volume claims..."
    kubectl delete pvc --all -n $namespace --timeout=30s | complete
    
    print $"  Deleting config and secrets..."
    kubectl delete configmaps,secrets --all -n $namespace --timeout=30s | complete
    
    print $"  Deleting ingress resources..."
    kubectl delete ingress --all -n $namespace --timeout=30s | complete
    
    # Step 7: Force cleanup any remaining persistent volumes
    print $"($color_cyan)7. Force cleaning up persistent volumes...($color_reset)"
    let remaining_pv_list = do {
        kubectl get pv | grep $namespace | awk '{print $1}' | complete
    }
    
    if $remaining_pv_list.exit_code == 0 and ($remaining_pv_list.stdout | str trim | str length) > 0 {
        let pv_names = ($remaining_pv_list.stdout | lines | where { |line| ($line | str trim | str length) > 0 })
        for pv_name in $pv_names {
            print $"  Force deleting PV: ($pv_name)"
            # Remove finalizers first, then delete
            kubectl patch pv ($pv_name | str trim) -p '{\"metadata\":{\"finalizers\":null}}' --type=merge | complete
            kubectl delete pv ($pv_name | str trim) --timeout=10s --force --grace-period=0 | complete
        }
    } else {
        print $"  No remaining persistent volumes found"
    }
    
    # Step 8: Delete the namespace
    print $"($color_cyan)8. Deleting namespace...($color_reset)"
    
    # First try to patch out any finalizers on the namespace itself
    print $"  Removing namespace finalizers..."
    kubectl patch namespace $namespace -p '{\"metadata\":{\"finalizers\":null}}' --type=merge | complete
    
    # Short timeout for initial deletion attempt
    let namespace_result = do {
        kubectl delete namespace $namespace --timeout=30s | complete
    }
    
    if $namespace_result.exit_code == 0 {
        print $"($color_green)Development environment for branch ($branch) destroyed successfully.($color_reset)"
    } else {
        print $"  ($color_yellow)Warning: Standard namespace deletion had issues. Attempting force cleanup...($color_reset)"
        
        # Wait a moment for any pending deletions to complete
        sleep 2sec
        
        # Check if namespace still exists
        let ns_check = do {
            kubectl get namespace $namespace | complete
        }
        
        if $ns_check.exit_code != 0 {
            print $"  ($color_green)Namespace was deleted during wait period.($color_reset)"
        } else {
            print $"  Namespace still exists, forcing deletion..."
            # Final attempt to delete namespace with grace period 0 and shorter timeout
            let force_namespace_result = do {
                kubectl delete namespace $namespace --grace-period=0 --force --timeout=20s | complete
            }
            
            if $force_namespace_result.exit_code == 0 {
                print $"  ($color_green)Namespace force deleted successfully.($color_reset)"
            } else {
                print $"  ($color_yellow)Force delete timed out or failed. Checking if deletion is in progress...($color_reset)"
                
                # Check final status
                let final_ns_check = do {
                    kubectl get namespace $namespace | complete
                }
                
                if $final_ns_check.exit_code != 0 {
                    print $"  ($color_green)Namespace deletion completed.($color_reset)"
                } else {
                    print $"  ($color_red)Namespace still exists. May require manual cleanup.($color_reset)"
                    print $"  ($color_yellow)The namespace may be stuck due to remaining finalizers.($color_reset)"
                    print $"  ($color_yellow)Try: kubectl patch namespace ($namespace) -p '{\\\"metadata\\\":{\\\"finalizers\\\":null}}' --type=merge($color_reset)"
                    print $"  ($color_yellow)Then: kubectl delete namespace ($namespace) --grace-period=0 --force($color_reset)"
                }
            }
        }
    }
    
    # Step 9: Final verification and cleanup
    print $"($color_cyan)9. Final verification...($color_reset)"
    let final_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $final_check.exit_code == 0 {
        print $"  ($color_yellow)Namespace still exists, attempting final cleanup...($color_reset)"
        # Last resort - try to remove any stuck finalizers on the namespace itself
        kubectl patch namespace $namespace -p '{\"metadata\":{\"finalizers\":null}}' --type=merge | complete
        kubectl delete namespace $namespace --grace-period=0 --force | complete
    } else {
        print $"  ($color_green)Namespace successfully removed.($color_reset)"
    }
}

# Force cleanup stuck development environment resources
def dev-env-force-cleanup [
    branch: string     # Branch name to force cleanup
] {
    # Sanitize branch name for namespace lookup
    let sanitized_branch = ($branch | str replace -a "/" "-" | str downcase | str replace -a "[^a-z0-9-]" "-" | str replace -r "^-+|-+$" "" | str replace -r "-+" "-")
    let namespace = $"alga-dev-($sanitized_branch)"

    # Helper to get all ai-api pods in the namespace
    def get-ai-pods [] {
        let pods_by_label = do {
            kubectl get pods -n $namespace -l 'app.kubernetes.io/component=ai-automation-api' -o jsonpath='{.items[*].metadata.name}' --ignore-not-found | complete
        }

        let pods_by_name = do {
            kubectl get pods -n $namespace -o jsonpath='{.items[*].metadata.name}' --ignore-not-found | complete
        }

        let pods1 = if $pods_by_label.exit_code == 0 and not ($pods_by_label.stdout | is-empty) {
            $pods_by_label.stdout | str trim | split row ' '
        } else {
            []
        }

        let pods2 = if $pods_by_name.exit_code == 0 and not ($pods_by_name.stdout | is-empty) {
            $pods_by_name.stdout | str trim | split row ' ' | where {|it| $it | str contains "ai-api"}
        } else {
            []
        }

        $pods1 | append $pods2 | uniq
    }
    
    print $"($color_cyan)Force cleaning up development environment for branch: ($branch)...($color_reset)"
    print $"($color_yellow)This will aggressively remove all resources and may take some time.($color_reset)"
    
    # Remove Helm release from both potential namespaces
    print $"($color_cyan)Removing Helm releases...($color_reset)"
    let release_name = $"alga-dev-($sanitized_branch)"
    
    # Check and remove from environment namespace
    let helm_check_ns = do { helm status $release_name -n $namespace | complete }
    if $helm_check_ns.exit_code == 0 {
        print $"($color_cyan)Removing release from ($namespace)...($color_reset)"
        helm uninstall $release_name -n $namespace | complete
    }
    
    # Check and remove from default namespace
    let helm_check_default = do { helm status $release_name -n default | complete }
    if $helm_check_default.exit_code == 0 {
        print $"($color_cyan)Removing release from default namespace...($color_reset)"
        helm uninstall $release_name -n default | complete
    }
    
    # Force stop ai-api pods first (known to cause stuck namespaces)
    print $"($color_cyan)Force stopping ai-api pods...($color_reset)"
    let pod_names_to_delete = (get-ai-pods)

    if ($pod_names_to_delete | is-empty) {
        print $"  No ai-api pods found."
    } else {
        print $"  Found pods to delete: ($pod_names_to_delete | str join ', ')"
        for pod in $pod_names_to_delete {
            if ($pod | str trim | str length) > 0 {
                print $"    Force deleting ai-api pod: ($pod)"
                kubectl delete pod $pod -n $namespace --force --grace-period=0 | complete
            }
        }

        # Wait for ai-api pods to be fully terminated
        print $"($color_cyan)Waiting for ai-api pods to terminate...($color_reset)"
        mut wait_retries = 0
        while $wait_retries < 15 { # Wait for up to 30 seconds
            let remaining_pods = (get-ai-pods)
            if ($remaining_pods | is-empty) {
                print $"\n($color_green)All targeted ai-api pods have been terminated.($color_reset)"
                break
            } else {
                print -n $"\r  Waiting... (remaining: ($remaining_pods | str join ', '))"
                sleep 2sec
                $wait_retries = $wait_retries + 1
            }
        }
        if $wait_retries >= 15 {
            print $"\n($color_yellow)Warning: Some ai-api pods may not have terminated correctly. Continuing...($color_reset)"
        }
    }

    # Delete all resources in the namespace
    print $"($color_cyan)Deleting all namespace resources...($color_reset)"
    kubectl delete all --all -n $namespace --timeout=30s | complete
    kubectl delete pvc --all -n $namespace --timeout=30s | complete
    kubectl delete configmaps,secrets --all -n $namespace --timeout=30s | complete
    kubectl delete ingress --all -n $namespace --timeout=30s | complete
    
    # Remove finalizers from persistent volumes if they exist
    print $"($color_cyan)Checking for stuck persistent volumes...($color_reset)"
    let pvs_result = do {
        kubectl get pv -o json | complete
    }
    
    if $pvs_result.exit_code == 0 {
        # This would require jq to parse JSON properly, so we'll skip PV cleanup for now
        print $"($color_yellow)Note: If PVs are stuck, you may need to manually remove finalizers($color_reset)"
    }
    
    # Force delete the namespace
    print $"($color_cyan)Force deleting namespace...($color_reset)"
    
    # Remove namespace finalizers first
    print $"  Removing namespace finalizers..."
    kubectl patch namespace $namespace -p '{\"metadata\":{\"finalizers\":null}}' --type=merge | complete
    
    let namespace_result = do {
        kubectl delete namespace $namespace --grace-period=0 --force --timeout=30s | complete
    }
    
    if $namespace_result.exit_code == 0 {
        print $"($color_green)Force cleanup completed successfully.($color_reset)"
    } else {
        # Wait and check if deletion completed
        print $"  Waiting for namespace deletion to complete..."
        sleep 3sec
        
        let final_check = do {
            kubectl get namespace $namespace | complete
        }
        
        if $final_check.exit_code != 0 {
            print $"($color_green)Namespace deletion completed after wait.($color_reset)"
        } else {
            print $"($color_yellow)Some resources may still need manual cleanup.($color_reset)"
            print $"($color_yellow)Check with: kubectl get all -A | grep ($sanitized_branch)($color_reset)"
            print $"($color_yellow)Or try: kubectl patch namespace ($namespace) -p '{\\\"metadata\\\":{\\\"finalizers\\\":null}}' --type=merge($color_reset)"
        }
    }
}

# Get environment status and URLs
def dev-env-status [
    branch?: string    # Optional branch name, shows all if omitted
] {
    if ($branch | is-empty) {
        dev-env-list
        return
    }
    
    # Sanitize branch name for namespace lookup
    let sanitized_branch = ($branch | str replace -a "/" "-" | str downcase | str replace -a "[^a-z0-9-]" "-" | str replace -r "^-+|-+$" "" | str replace -r "-+" "-")
    let namespace = $"alga-dev-($sanitized_branch)"
    
    # Check if environment exists
    let env_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $env_check.exit_code != 0 {
        print $"($color_red)Environment for branch ($branch) not found.($color_reset)"
        print $"($color_yellow)Use 'dev-env-list' to see available environments.($color_reset)"
        return
    }
    
    print $"($color_cyan)Development Environment Status - Branch: ($branch)($color_reset)"
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
        kubectl get ingress -n $namespace -o jsonpath='{range .items[*]}{range .spec.rules[*]}{.host}{"\n"}{end}{end}' | complete
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
    
    # Get external ports if available
    let ports_result = do {
        kubectl get configmap -n $namespace $"alga-dev-($sanitized_branch)-external-ports" -o json | complete
    }
    
    if $ports_result.exit_code == 0 {
        # Parse the ConfigMap data
        let configmap_data = ($ports_result.stdout | from json)
        let ports_data = $configmap_data.data
        
        print $"($color_cyan)Assigned External Ports:($color_reset)"
        print $"  Main App:        localhost:($ports_data.app)"
        print $"  Code Server:     localhost:($ports_data.codeServer)"
        print $"  Code App:        localhost:($ports_data.codeApp)"
        print $"  AI Web:          localhost:($ports_data.aiWeb)"
        print ""
    }
    
    # Port forward instructions
    print $"($color_cyan)Local Access - Port Forward:($color_reset)"
    print $"  Run: dev-env-connect ($branch)"
    print $"  This will use the pre-assigned ports shown above"
    
    print ""
    print $"($color_cyan)Management Commands:($color_reset)"
    print $"  Connect:  dev-env-connect ($branch)"
    print $"  Destroy:  dev-env-destroy ($branch) [--force]"
}

# Build Docker image for specified edition
def build-image [
    edition: string,         # Edition to build (ce or ee) 
    --tag: string = ""       # Docker tag to use (defaults to unique tag)
    --push                   # Push to registry after building
    --use-latest             # Use 'latest' tag instead of unique tag
] {
    if not ($edition in ["ce", "ee"]) {
        error make { msg: $"($color_red)Edition must be 'ce' or 'ee'($color_reset)" }
    }
    
    print $"($color_cyan)Building ($edition | str upcase) Docker image...($color_reset)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name and build context
    let image_name = $"harbor.nineminds.com/nineminds/alga-psa-($edition)"
    
    # Generate unique tag if not provided and not using latest
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Build tag arguments for docker build
    let tag_args = ($tags_to_apply | each { |t| ["-t", $"($image_name):($t)"] } | flatten)
    
    # Build the image
    print $"($color_yellow)Building with tags: ($tags_to_apply | str join ', ')($color_reset)"
    print $"($color_cyan)Build output will be streamed to terminal...($color_reset)"
    
    if $edition == "ee" {
        # EE build includes everything
        docker build --platform linux/amd64 -f server/Dockerfile ...$tag_args .
    } else {
        # CE build excludes EE directory
        docker build --platform linux/amd64 -f server/Dockerfile ...$tag_args --build-arg EXCLUDE_EE=true .
    }
    
    # Check if build succeeded by checking if image exists
    let image_check = do {
        docker image inspect $"($image_name):($sha_tag)" | complete
    }
    
    if $image_check.exit_code != 0 {
        print $"($color_red)Build failed - image not created($color_reset)"
        error make { msg: "Docker build failed" }
    }
    
    print $"($color_green)Successfully built with tags: ($tags_to_apply | str join ', ')($color_reset)"
    
    if $push {
        # Push all tags
        for tag in $tags_to_apply {
            let full_tag = $"($image_name):($tag)"
            print $"($color_yellow)Pushing: ($full_tag)($color_reset)"
            print $"($color_cyan)Push output will be streamed to terminal...($color_reset)"
            
            # Push the image - stream output directly
            docker push $full_tag
            
            # Check if push succeeded
            let push_check = do {
                docker manifest inspect $full_tag | complete
            }
            
            if $push_check.exit_code != 0 {
                print $"($color_red)Push may have failed for ($full_tag) - unable to verify image in registry($color_reset)"
                print $"($color_yellow)Note: This could also mean the registry doesn't support manifest inspection($color_reset)"
            } else {
                print $"($color_green)Successfully pushed: ($full_tag)($color_reset)"
            }
        }
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

# Build code-server Docker image
def build-code-server [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
] {
    print $"($color_cyan)Building code-server Docker image...($color_reset)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name
    let registry = "harbor.nineminds.com"
    let namespace = "nineminds"
    let image_name = "alga-code-server"
    let base_image = $"($registry)/($namespace)/($image_name)"
    
    # Generate SHA tag
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Build tag arguments for docker build
    let tag_args = ($tags_to_apply | each { |t| ["-t", $"($base_image):($t)"] } | flatten)
    
    print $"($color_yellow)Building with tags: ($tags_to_apply | str join ', ')($color_reset)"
    print $"($color_cyan)Build output will be streamed to terminal...($color_reset)"
    
    # Build the image - stream output directly
    docker build --platform linux/amd64 -f docker/dev-env/Dockerfile.code-server ...$tag_args .
    
    # Check if build succeeded by checking if image exists
    let image_check = do {
        docker image inspect $"($base_image):($sha_tag)" | complete
    }
    
    if $image_check.exit_code != 0 {
        print $"($color_red)Build failed - image not created($color_reset)"
        error make { msg: "Docker build failed" }
    }
    
    print $"($color_green)Successfully built with tags: ($tags_to_apply | str join ', ')($color_reset)"
    
    if $push {
        # Push all tags
        for tag in $tags_to_apply {
            let full_image = $"($base_image):($tag)"
            print $"($color_yellow)Pushing: ($full_image)($color_reset)"
            print $"($color_cyan)Push output will be streamed to terminal...($color_reset)"
            
            # Push the image - stream output directly
            docker push $full_image
            
            # Check if push succeeded by trying to pull the image info from registry
            let push_check = do {
                docker manifest inspect $full_image | complete
            }
            
            if $push_check.exit_code != 0 {
                print $"($color_red)Push may have failed for ($full_image) - unable to verify image in registry($color_reset)"
                print $"($color_yellow)Note: This could also mean the registry doesn't support manifest inspection($color_reset)"
            } else {
                print $"($color_green)Successfully pushed: ($full_image)($color_reset)"
            }
        }
    }
}

# Build AI API Docker image
def build-ai-api [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
] {
    print $"($color_cyan)Building AI API Docker image...($color_reset)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name
    let registry = "harbor.nineminds.com"
    let namespace = "nineminds"
    let image_name = "alga-ai-api"
    let base_image = $"($registry)/($namespace)/($image_name)"
    
    # Generate SHA tag
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Build tag arguments for docker build
    let tag_args = ($tags_to_apply | each { |t| ["-t", $"($base_image):($t)"] } | flatten)
    
    print $"($color_yellow)Building with tags: ($tags_to_apply | str join ', ')($color_reset)"
    print $"($color_cyan)Build output will be streamed to terminal...($color_reset)"
    
    # Build the image from the ai-automation directory
    cd ($project_root | path join "tools" "ai-automation")
    docker build --platform linux/amd64 -f Dockerfile ...$tag_args .
    
    # Check if build succeeded by checking if image exists
    let image_check = do {
        docker image inspect $"($base_image):($sha_tag)" | complete
    }
    
    if $image_check.exit_code != 0 {
        print $"($color_red)Build failed - image not created($color_reset)"
        error make { msg: "Docker build failed" }
    }
    
    print $"($color_green)Successfully built with tags: ($tags_to_apply | str join ', ')($color_reset)"
    
    if $push {
        # Push all tags
        for tag in $tags_to_apply {
            let full_image = $"($base_image):($tag)"
            print $"($color_yellow)Pushing: ($full_image)($color_reset)"
            print $"($color_cyan)Push output will be streamed to terminal...($color_reset)"
            
            # Push the image - stream output directly
            docker push $full_image
            
            # Check if push succeeded by trying to pull the image info from registry
            let push_check = do {
                docker manifest inspect $full_image | complete
            }
            
            if $push_check.exit_code != 0 {
                print $"($color_red)Push may have failed for ($full_image) - unable to verify image in registry($color_reset)"
                print $"($color_yellow)Note: This could also mean the registry doesn't support manifest inspection($color_reset)"
            } else {
                print $"($color_green)Successfully pushed: ($full_image)($color_reset)"
            }
        }
    }
}

# Build AI Web Docker image
def build-ai-web [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
    --local                  # Build locally instead of in Kubernetes
    --cpu: string = "4"      # CPU cores to allocate for Kubernetes builds
    --memory: string = "4Gi" # Memory to allocate for Kubernetes builds
] {
    # If --local flag is NOT set, use Kubernetes build (default)
    if not $local {
        if $push and $use_latest {
            build-ai-web-k8s --tag $tag --push --use-latest --cpu $cpu --memory $memory
        } else if $push {
            build-ai-web-k8s --tag $tag --push --cpu $cpu --memory $memory
        } else if $use_latest {
            build-ai-web-k8s --tag $tag --use-latest --cpu $cpu --memory $memory
        } else {
            build-ai-web-k8s --tag $tag --cpu $cpu --memory $memory
        }
        return
    }
    
    # Local build logic
    print $"($color_cyan)Building AI Web Docker image locally...($color_reset)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name
    let registry = "harbor.nineminds.com"
    let namespace = "nineminds"
    let image_name = "alga-ai-web"
    let base_image = $"($registry)/($namespace)/($image_name)"
    
    # Generate SHA tag
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Build tag arguments for docker build
    let tag_args = ($tags_to_apply | each { |t| ["-t", $"($base_image):($t)"] } | flatten)
    
    print $"($color_yellow)Building with tags: ($tags_to_apply | str join ', ')($color_reset)"
    print $"($color_cyan)Build output will be streamed to terminal...($color_reset)"
    
    # Build the image from the ai-automation/web directory
    cd ($project_root | path join "tools" "ai-automation" "web")
    docker build --platform linux/amd64 -f Dockerfile ...$tag_args .
    
    # Check if build succeeded by checking if image exists
    let image_check = do {
        docker image inspect $"($base_image):($sha_tag)" | complete
    }
    
    if $image_check.exit_code != 0 {
        print $"($color_red)Build failed - image not created($color_reset)"
        error make { msg: "Docker build failed" }
    }
    
    print $"($color_green)Successfully built with tags: ($tags_to_apply | str join ', ')($color_reset)"
    
    if $push {
        # Push all tags
        for tag in $tags_to_apply {
            let full_image = $"($base_image):($tag)"
            print $"($color_yellow)Pushing: ($full_image)($color_reset)"
            print $"($color_cyan)Push output will be streamed to terminal...($color_reset)"
            
            # Push the image - stream output directly
            docker push $full_image
            
            # Check if push succeeded by trying to pull the image info from registry
            let push_check = do {
                docker manifest inspect $full_image | complete
            }
            
            if $push_check.exit_code != 0 {
                print $"($color_red)Push may have failed for ($full_image) - unable to verify image in registry($color_reset)"
                print $"($color_yellow)Note: This could also mean the registry doesn't support manifest inspection($color_reset)"
            } else {
                print $"($color_green)Successfully pushed: ($full_image)($color_reset)"
            }
        }
    }
}

# Build AI Web Docker image using Kubernetes job
def build-ai-web-k8s [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
    --namespace: string = "default"  # Kubernetes namespace to run the job in
    --cpu: string = "4"      # CPU cores to allocate
    --memory: string = "4Gi" # Memory to allocate
] {
    print $"($color_cyan)Building AI Web Docker image using Kubernetes job...($color_reset)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name
    let registry = "harbor.nineminds.com"
    let namespace_img = "nineminds"
    let image_name = "alga-ai-web"
    let base_image = $"($registry)/($namespace_img)/($image_name)"
    
    # Generate SHA tag
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Get current git branch/ref
    let git_ref = (git rev-parse HEAD | complete)
    let current_ref = if $git_ref.exit_code == 0 {
        ($git_ref.stdout | str trim)
    } else {
        "main"
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Generate unique job name
    let timestamp = (date now | format date '%Y%m%d-%H%M%S')
    let job_name = $"ai-web-build-($timestamp)"
    
    print $"($color_yellow)Building with tags: ($tags_to_apply | str join ', ')($color_reset)"
    print $"($color_yellow)Using Kubernetes job: ($job_name)($color_reset)"
    print $"($color_cyan)Using existing harbor-credentials secret for registry authentication($color_reset)"
    
    # Create values file for the Helm job
    let values_content = {
        buildJob: {
            name: $job_name,
            namespace: $namespace,
            type: "ai-web",
            timeout: 1800,
            ttl: 300,
            gitRepo: "https://github.com/nine-minds/alga-psa.git",
            gitRef: $current_ref,
            buildPath: "tools/ai-automation/web",
            dockerfile: "Dockerfile",
            context: ".",
            registry: $registry,
            push: $push,
            tags: ($tags_to_apply | each { |t| $"($base_image):($t)" }),
            resources: {
                cpu: $cpu,
                memory: $memory,
                cpuLimit: $cpu,
                memoryLimit: $memory
            }
        }
    }
    
    print $"($color_cyan)Creating build job in Kubernetes...($color_reset)"
    
    # Ensure harbor-credentials exists in the namespace
    let secret_check = do {
        kubectl get secret harbor-credentials -n $namespace | complete
    }
    
    if $secret_check.exit_code != 0 {
        print $"($color_yellow)Copying harbor-credentials to namespace ($namespace)...($color_reset)"
        let copy_result = do {
            kubectl get secret harbor-credentials -n nineminds -o yaml | sed $"s/namespace: nineminds/namespace: ($namespace)/" | kubectl apply -f - | complete
        }
        
        if $copy_result.exit_code != 0 {
            print $"($color_red)Failed to copy harbor-credentials to namespace($color_reset)"
            error make { msg: "Harbor credentials not available in target namespace" }
        }
    }
    
    # Build docker tags arguments
    let docker_tags = ($tags_to_apply | each { |t| $"-t ($base_image):($t)" } | str join ' ')
    
    # Build push commands if needed
    let push_commands = if $push {
        let push_cmds = ($tags_to_apply | each { |t| $"docker push ($base_image):($t)" } | str join "\n")
        $"echo 'Pushing Docker images...'\n($push_cmds)"
    } else {
        ""
    }
    
    # Create the shell script content
    let build_script = '#!/bin/sh
set -e
echo "Starting build process..."

# Wait for Docker daemon to be ready
timeout=60
until docker info >/dev/null 2>&1; do
  if [ $timeout -le 0 ]; then
    echo "Docker daemon did not start in time"
    exit 1
  fi
  echo "Waiting for Docker daemon..."
  timeout=$((timeout - 5))
  sleep 5
done

echo "Docker daemon is ready"

# Configure Docker to use the registry from harbor-credentials secret
echo "Configuring Docker registry authentication..."
mkdir -p /root/.docker
cp /harbor-creds/.dockerconfigjson /root/.docker/config.json
echo "Docker registry authentication configured"

# Clone the repository
echo "Cloning repository..."
git clone https://github.com/nine-minds/alga-psa.git /workspace
cd /workspace

# Checkout the specified branch/commit
echo "Checking out ' + $current_ref + '..."
git checkout ' + $current_ref + '

# Navigate to the build directory
cd tools/ai-automation/web

# Build the Docker image
echo "Building Docker image..."
docker build --platform linux/amd64 -f Dockerfile ' + $docker_tags + ' .

# Push the images if requested
' + $push_commands + '

echo "Build completed successfully!"

# Signal the docker daemon to shut down
echo "Signaling Docker daemon to shut down..."
touch /tmp/build-complete'
    
    # Create job manifest
    let job_manifest = {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
            name: $job_name,
            namespace: $namespace,
            labels: {
                app: "alga-build-job",
                "build-type": "ai-web"
            }
        },
        spec: {
            activeDeadlineSeconds: 1800,
            ttlSecondsAfterFinished: 300,
            template: {
                metadata: {
                    labels: {
                        app: "alga-build-job",
                        "build-type": "ai-web"
                    }
                },
                spec: {
                    restartPolicy: "Never",
                    containers: [{
                        name: "build",
                        image: "docker:24-dind",
                        command: ["/bin/sh"],
                        args: ["-c", $build_script],
                        env: [{
                            name: "DOCKER_HOST",
                            value: "tcp://localhost:2375"
                        }],
                        resources: {
                            requests: {
                                memory: $memory,
                                cpu: $cpu
                            },
                            limits: {
                                memory: $memory,
                                cpu: $cpu
                            }
                        },
                        volumeMounts: [{
                            name: "workspace",
                            mountPath: "/workspace"
                        }, {
                            name: "harbor-creds",
                            mountPath: "/harbor-creds",
                            readOnly: true
                        }, {
                            name: "shared",
                            mountPath: "/tmp"
                        }]
                    }, {
                        name: "docker-daemon",
                        image: "docker:24-dind",
                        command: ["/bin/sh"],
                        args: ["-c", "dockerd-entrypoint.sh & while [ ! -f /tmp/build-complete ]; do sleep 5; done; echo 'Build complete signal received, shutting down...'; sleep 10"],
                        securityContext: {
                            privileged: true
                        },
                        env: [{
                            name: "DOCKER_TLS_CERTDIR",
                            value: ""
                        }],
                        resources: {
                            requests: {
                                memory: "1Gi",
                                cpu: "1"
                            },
                            limits: {
                                memory: "2Gi",
                                cpu: "2"
                            }
                        },
                        volumeMounts: [{
                            name: "docker-storage",
                            mountPath: "/var/lib/docker"
                        }, {
                            name: "shared",
                            mountPath: "/tmp"
                        }]
                    }],
                    volumes: [{
                        name: "workspace",
                        emptyDir: {}
                    }, {
                        name: "docker-storage",
                        emptyDir: {}
                    }, {
                        name: "shared",
                        emptyDir: {}
                    }, {
                        name: "harbor-creds",
                        secret: {
                            secretName: "harbor-credentials",
                            items: [{
                                key: ".dockerconfigjson",
                                path: ".dockerconfigjson"
                            }]
                        }
                    }]
                }
            }
        }
    }
    
    # Write job manifest to file
    let job_file = $"/tmp/build-job-($timestamp).yaml"
    $job_manifest | to yaml | save -f $job_file
    
    # Create the job
    let helm_result = do {
        kubectl apply -f $job_file -n $namespace | complete
    }
    
    if $helm_result.exit_code != 0 {
        print $"($color_red)Failed to create build job($color_reset)"
        rm -f $job_file
        error make { msg: "Failed to create Kubernetes job" }
    }
    
    print $"($color_green)Build job created successfully($color_reset)"
    print $"($color_cyan)Monitoring job progress...($color_reset)"
    
    # Monitor the job
    let start_time = (date now | format date '%s' | into int)
    let timeout_seconds = 1800  # 30 minutes
    
    loop {
        # Check job status
        let job_status = do {
            kubectl get job $job_name -n $namespace -o json | complete
        }
        
        if $job_status.exit_code != 0 {
            print $"($color_red)Failed to get job status($color_reset)"
            break
        }
        
        let status = ($job_status.stdout | from json)
        
        # Check if job completed
        if ("succeeded" in $status.status) and ($status.status.succeeded? | default 0) > 0 {
            print $"($color_green)Build completed successfully!($color_reset)"
            break
        }
        
        # Check if job failed
        if ("failed" in $status.status) and ($status.status.failed? | default 0) > 0 {
            print $"($color_red)Build failed!($color_reset)"
            
            # Get pod logs
            let pods = do {
                kubectl get pods -n $namespace -l job-name=$job_name -o json | complete
            }
            
            if $pods.exit_code == 0 {
                let pod_list = ($pods.stdout | from json)
                if ($pod_list.items | length) > 0 {
                    let pod_name = $pod_list.items.0.metadata.name
                    print $"($color_yellow)Fetching logs from pod: ($pod_name)($color_reset)"
                    kubectl logs $pod_name -n $namespace -c build --tail=100
                }
            }
            
            # Clean up job
            kubectl delete job $job_name -n $namespace --ignore-not-found | complete
            rm -f $job_file
            error make { msg: "Build job failed" }
        }
        
        # Check timeout
        let current_time = (date now | format date '%s' | into int)
        let elapsed = ($current_time - $start_time)
        
        if $elapsed > $timeout_seconds {
            print $"($color_red)Build timed out after ($elapsed) seconds($color_reset)"
            kubectl delete job $job_name -n $namespace --ignore-not-found | complete
            rm -f $job_file
            error make { msg: "Build job timed out" }
        }
        
        # Get current pod status
        let pods = do {
            kubectl get pods -n $namespace -l job-name=$job_name --no-headers | complete
        }
        
        if $pods.exit_code == 0 and ($pods.stdout | str trim | str length) > 0 {
            print -n $"\r($color_cyan)Job status: ($pods.stdout | str trim | split column -c '\\s+' | get column2.0)/Running - Elapsed: ($elapsed)s($color_reset)"
        }
        
        sleep 5sec
    }
    
    # Stream logs from the completed job
    print $"\n($color_cyan)Build logs:($color_reset)"
    let pods = do {
        kubectl get pods -n $namespace -l job-name=$job_name -o json | complete
    }
    
    if $pods.exit_code == 0 {
        let pod_list = ($pods.stdout | from json)
        if ($pod_list.items | length) > 0 {
            let pod_name = $pod_list.items.0.metadata.name
            kubectl logs $pod_name -n $namespace -c build
        }
    }
    
    # Clean up
    print $"($color_cyan)Cleaning up...($color_reset)"
    kubectl delete job $job_name -n $namespace --ignore-not-found | complete
    rm -f $job_file
    
    print $"($color_green)Build process completed!($color_reset)"
    
    if $push {
        for tag in $tags_to_apply {
            print $"($color_green)Image pushed: ($base_image):($tag)($color_reset)"
        }
    }
}

# Build all AI Docker images (API and Web)
def build-ai-all [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
] {
    print $"($color_cyan)Building all AI Docker images...($color_reset)"
    
    # Build AI API
    if $push and $use_latest {
        build-ai-api --tag $tag --push --use-latest
    } else if $push {
        build-ai-api --tag $tag --push
    } else if $use_latest {
        build-ai-api --tag $tag --use-latest
    } else {
        build-ai-api --tag $tag
    }
    
    # Build AI Web
    if $push and $use_latest {
        build-ai-web --tag $tag --push --use-latest
    } else if $push {
        build-ai-web --tag $tag --push
    } else if $use_latest {
        build-ai-web --tag $tag --use-latest
    } else {
        build-ai-web --tag $tag
    }
    
    print $"($color_green)All AI images built successfully!($color_reset)"
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
       print "  nu main.nu dev-env-create <branch> [--edition ce|ee] [--use-latest] [--checkout] [--from-tag <tag>]"
       print "    Create on-demand development environment for branch"
       print "    --use-latest: Use 'latest' tag instead of unique tag (avoids cache issues by default)"
       print "    --checkout: Checkout the branch locally (default: true)"
       print "    --from-tag: Deploy from existing image tag instead of building (mutually exclusive with --use-latest)"
       print "    Example: nu main.nu dev-env-create my-feature --edition ee"
       print "    Example: nu main.nu dev-env-create my-feature --from-tag v1.2.3"
       print "  nu main.nu dev-env-list           # List active development environments"
       print "  nu main.nu dev-env-connect <branch>"
       print "    Connect to development environment with port forwarding"
       print "  nu main.nu dev-env-destroy <branch> [--force]"
       print "    Destroy development environment"
       print "  nu main.nu dev-env-force-cleanup <branch>"
       print "    Force cleanup stuck development environment"
       print "  nu main.nu dev-env-status [<branch>]"
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
       print "  nu main.nu build-image <edition> [--tag <tag>] [--push] [--use-latest]"
       print "    Build Docker image for specified edition (ce|ee)"
       print "    --use-latest: Tag with both SHA and 'latest' (pushes both tags if --push is used)"
       print "    Example: nu main.nu build-image ce --tag v1.0.0 --push"
       print "    Example: nu main.nu build-image ee --use-latest --push"
       print "  nu main.nu build-all-images [--tag <tag>] [--push]"
       print "    Build Docker images for both CE and EE editions"
       print "    Example: nu main.nu build-all-images --tag latest --push"
       print "  nu main.nu build-code-server [--tag <tag>] [--push] [--use-latest]"
       print "    Build code-server Docker image"
       print "    --use-latest: Tag with both SHA and 'latest' (pushes both tags if --push is used)"
       print "    Example: nu main.nu build-code-server --push"
       print "    Example: nu main.nu build-code-server --tag v1.0.0 --push"
       print "  nu main.nu build-ai-api [--tag <tag>] [--push] [--use-latest]"
       print "    Build AI API Docker image"
       print "    Example: nu main.nu build-ai-api --push"
       print "    Example: nu main.nu build-ai-api --use-latest --push"
       print "  nu main.nu build-ai-web [--tag <tag>] [--push] [--use-latest] [--local] [--cpu <cores>] [--memory <size>]"
       print "    Build AI Web Docker image (in Kubernetes by default)"
       print "    --local: Build locally instead of in Kubernetes"
       print "    --cpu: CPU cores to allocate for Kubernetes builds (default: 4)"
       print "    --memory: Memory to allocate for Kubernetes builds (default: 4Gi)"
       print "    Example: nu main.nu build-ai-web --push"
       print "    Example: nu main.nu build-ai-web --push --cpu 8 --memory 8Gi"
       print "    Example: nu main.nu build-ai-web --local --push  # for local build"
       print "  nu main.nu build-ai-web-k8s [--tag <tag>] [--push] [--use-latest] [--namespace <ns>] [--cpu <cores>] [--memory <size>]"
       print "    Build AI Web Docker image using Kubernetes job (faster, uses server resources)"
       print "    --namespace: Kubernetes namespace (default: default)"
       print "    --cpu: CPU cores to allocate (default: 4)"
       print "    --memory: Memory to allocate (default: 4Gi)"
       print "    Example: nu main.nu build-ai-web-k8s --push"
       print "    Example: nu main.nu build-ai-web-k8s --tag v1.0.0 --push --cpu 8 --memory 8Gi"
       print "  nu main.nu build-ai-all [--tag <tag>] [--push] [--use-latest]"
       print "    Build all AI Docker images (API and Web)"
       print "    Example: nu main.nu build-ai-all --push"
       print "    Example: nu main.nu build-ai-all --use-latest --push"
       print ""
       print "Alternatively, source the script ('source main.nu') and run commands directly:"
       print "  dev-env-create my-feature"
       print "  dev-env-list"
       print "  dev-env-connect my-feature"
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
       print "  nu main.nu dev-env-create <branch> [--edition ce|ee] [--use-latest] [--checkout] [--from-tag <tag>]"
       print "    Create on-demand development environment for branch"
       print "    --use-latest: Use 'latest' tag instead of unique tag (avoids cache issues by default)"
       print "    --checkout: Checkout the branch locally (default: true)"
       print "    --from-tag: Deploy from existing image tag instead of building (mutually exclusive with --use-latest)"
       print "    Example: nu main.nu dev-env-create my-feature --edition ee"
       print "    Example: nu main.nu dev-env-create my-feature --from-tag v1.2.3"
       print "  nu main.nu dev-env-list           # List active development environments"
       print "  nu main.nu dev-env-connect <branch>"
       print "    Connect to development environment with port forwarding"
       print "  nu main.nu dev-env-destroy <branch> [--force]"
       print "    Destroy development environment"
       print "  nu main.nu dev-env-force-cleanup <branch>"
       print "    Force cleanup stuck development environment"
       print "  nu main.nu dev-env-status [<branch>]"
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
       print "  nu main.nu build-image <edition> [--tag <tag>] [--push] [--use-latest]"
       print "    Build Docker image for specified edition (ce|ee)"
       print "    --use-latest: Tag with both SHA and 'latest' (pushes both tags if --push is used)"
       print "    Example: nu main.nu build-image ce --tag v1.0.0 --push"
       print "    Example: nu main.nu build-image ee --use-latest --push"
       print "  nu main.nu build-all-images [--tag <tag>] [--push]"
       print "    Build Docker images for both CE and EE editions"
       print "    Example: nu main.nu build-all-images --tag latest --push"
       print "  nu main.nu build-code-server [--tag <tag>] [--push] [--use-latest]"
       print "    Build code-server Docker image"
       print "    --use-latest: Tag with both SHA and 'latest' (pushes both tags if --push is used)"
       print "    Example: nu main.nu build-code-server --push"
       print "    Example: nu main.nu build-code-server --tag v1.0.0 --push"
       print "  nu main.nu build-ai-api [--tag <tag>] [--push] [--use-latest]"
       print "    Build AI API Docker image"
       print "    Example: nu main.nu build-ai-api --push"
       print "    Example: nu main.nu build-ai-api --use-latest --push"
       print "  nu main.nu build-ai-web [--tag <tag>] [--push] [--use-latest] [--local] [--cpu <cores>] [--memory <size>]"
       print "    Build AI Web Docker image (in Kubernetes by default)"
       print "    --local: Build locally instead of in Kubernetes"
       print "    --cpu: CPU cores to allocate for Kubernetes builds (default: 4)"
       print "    --memory: Memory to allocate for Kubernetes builds (default: 4Gi)"
       print "    Example: nu main.nu build-ai-web --push"
       print "    Example: nu main.nu build-ai-web --push --cpu 8 --memory 8Gi"
       print "    Example: nu main.nu build-ai-web --local --push  # for local build"
       print "  nu main.nu build-ai-web-k8s [--tag <tag>] [--push] [--use-latest] [--namespace <ns>] [--cpu <cores>] [--memory <size>]"
       print "    Build AI Web Docker image using Kubernetes job (faster, uses server resources)"
       print "    --namespace: Kubernetes namespace (default: default)"
       print "    --cpu: CPU cores to allocate (default: 4)"
       print "    --memory: Memory to allocate (default: 4Gi)"
       print "    Example: nu main.nu build-ai-web-k8s --push"
       print "    Example: nu main.nu build-ai-web-k8s --tag v1.0.0 --push --cpu 8 --memory 8Gi"
       print "  nu main.nu build-ai-all [--tag <tag>] [--push] [--use-latest]"
       print "    Build all AI Docker images (API and Web)"
       print "    Example: nu main.nu build-ai-all --push"
       print "    Example: nu main.nu build-ai-all --use-latest --push"
       print "\nAlternatively, source the script ('source main.nu') and run commands directly:"
       print "  migrate <action>"
       print "  dev-up [--detached] [--edition ce|ee]"
       print "  dev-down"
       print "  update-workflow <workflow_name>"
       print "  register-workflow <workflow_name>"
       print "  dev-env-create <branch> [options]"
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
           let branch = ($args | get 1? | default null)
           if $branch == null {
               error make { msg: $"($color_red)dev-env-create command requires a branch name($color_reset)" }
           }
           
           # Parse flags
           let command_args = ($args | skip 2)
           
           let edition_idx = ($command_args | enumerate | where {|item| $item.item == "--edition"} | get 0?.index | default null)
           let edition = if $edition_idx != null { 
               ($command_args | get ($edition_idx + 1) | default "ce")
           } else { 
               "ce" 
           }
           
           let from_tag_idx = ($command_args | enumerate | where {|item| $item.item == "--from-tag"} | get 0?.index | default null)
           let from_tag = if $from_tag_idx != null { 
               ($command_args | get ($from_tag_idx + 1) | default "")
           } else { 
               "" 
           }
           
           let use_latest = ($command_args | any { |arg| $arg == "--use-latest" })
           let checkout = not ($command_args | any { |arg| $arg == "--no-checkout" })
           
           # Call the dev-env-create command
           dev-env-create $branch --edition $edition --use-latest=$use_latest --checkout=$checkout --from-tag $from_tag
       }
       "dev-env-list" => {
           dev-env-list
       }
       "dev-env-connect" => {
           let branch = ($args | get 1? | default null)
           if $branch == null {
               error make { msg: $"($color_red)dev-env-connect command requires a branch name($color_reset)" }
           }
           
           # Call the dev-env-connect command (port forwarding is now always enabled)
           dev-env-connect $branch
       }
       "dev-env-destroy" => {
           let branch = ($args | get 1? | default null)
           if $branch == null {
               error make { msg: $"($color_red)dev-env-destroy command requires a branch name($color_reset)" }
           }
           
           # Parse flags
           let command_args = ($args | skip 2)
           let force = ($command_args | any { |arg| $arg == "--force" })
           
           # Call the dev-env-destroy command
           if $force {
               dev-env-destroy $branch --force
           } else {
               dev-env-destroy $branch
           }
       }
       "dev-env-status" => {
           let branch = ($args | get 1? | default null)
           if $branch != null {
               dev-env-status $branch
           } else {
               dev-env-status
           }
       }
       "dev-env-force-cleanup" => {
           let branch = ($args | get 1? | default null)
           if $branch == null {
               error make { msg: $"($color_red)dev-env-force-cleanup command requires a branch name($color_reset)" }
           }
           # Call the dev-env-force-cleanup command
           dev-env-force-cleanup $branch
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
           let tag = if $tag_idx != null { ($command_args | get ($tag_idx + 1) | default "") } else { "" }
           let push = ($command_args | any { |arg| $arg == "--push" })
           let use_latest = ($command_args | any { |arg| $arg == "--use-latest" })
           
           # Call the build-image command
           if $push and $use_latest {
               build-image $edition --tag $tag --push --use-latest
           } else if $push {
               build-image $edition --tag $tag --push
           } else if $use_latest {
               build-image $edition --tag $tag --use-latest
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
       "build-code-server" => {
           # Parse flags
           let command_args = ($args | skip 1)
           let tag_idx = ($command_args | enumerate | where {|item| $item.item == "--tag"} | get 0?.index | default null)
           let tag = if $tag_idx != null { ($command_args | get ($tag_idx + 1) | default "") } else { "" }
           let push = ($command_args | any { |arg| $arg == "--push" })
           let use_latest = ($command_args | any { |arg| $arg == "--use-latest" })
           
           # Call the build-code-server command
           if $push and $use_latest {
               build-code-server --tag $tag --push --use-latest
           } else if $push {
               build-code-server --tag $tag --push
           } else if $use_latest {
               build-code-server --tag $tag --use-latest
           } else {
               build-code-server --tag $tag
           }
       }
       "build-ai-api" => {
           # Parse flags
           let command_args = ($args | skip 1)
           let tag_idx = ($command_args | enumerate | where {|item| $item.item == "--tag"} | get 0?.index | default null)
           let tag = if $tag_idx != null { ($command_args | get ($tag_idx + 1) | default "") } else { "" }
           let push = ($command_args | any { |arg| $arg == "--push" })
           let use_latest = ($command_args | any { |arg| $arg == "--use-latest" })
           
           # Call the build-ai-api command
           if $push and $use_latest {
               build-ai-api --tag $tag --push --use-latest
           } else if $push {
               build-ai-api --tag $tag --push
           } else if $use_latest {
               build-ai-api --tag $tag --use-latest
           } else {
               build-ai-api --tag $tag
           }
       }
       "build-ai-web" => {
           # Parse flags
           let command_args = ($args | skip 1)
           let tag_idx = ($command_args | enumerate | where {|item| $item.item == "--tag"} | get 0?.index | default null)
           let tag = if $tag_idx != null { ($command_args | get ($tag_idx + 1) | default "") } else { "" }
           let push = ($command_args | any { |arg| $arg == "--push" })
           let use_latest = ($command_args | any { |arg| $arg == "--use-latest" })
           let local = ($command_args | any { |arg| $arg == "--local" })
           let cpu_idx = ($command_args | enumerate | where {|item| $item.item == "--cpu"} | get 0?.index | default null)
           let cpu = if $cpu_idx != null { ($command_args | get ($cpu_idx + 1) | default "4") } else { "4" }
           let memory_idx = ($command_args | enumerate | where {|item| $item.item == "--memory"} | get 0?.index | default null)
           let memory = if $memory_idx != null { ($command_args | get ($memory_idx + 1) | default "4Gi") } else { "4Gi" }
           
           # Call the build-ai-web command
           if $local {
               if $push and $use_latest {
                   build-ai-web --tag $tag --push --use-latest --local
               } else if $push {
                   build-ai-web --tag $tag --push --local
               } else if $use_latest {
                   build-ai-web --tag $tag --use-latest --local
               } else {
                   build-ai-web --tag $tag --local
               }
           } else if $push and $use_latest {
               build-ai-web --tag $tag --push --use-latest --cpu $cpu --memory $memory
           } else if $push {
               build-ai-web --tag $tag --push --cpu $cpu --memory $memory
           } else if $use_latest {
               build-ai-web --tag $tag --use-latest --cpu $cpu --memory $memory
           } else {
               build-ai-web --tag $tag --cpu $cpu --memory $memory
           }
       }
       "build-ai-web-k8s" => {
           # Parse flags
           let command_args = ($args | skip 1)
           let tag_idx = ($command_args | enumerate | where {|item| $item.item == "--tag"} | get 0?.index | default null)
           let tag = if $tag_idx != null { ($command_args | get ($tag_idx + 1) | default "") } else { "" }
           let push = ($command_args | any { |arg| $arg == "--push" })
           let use_latest = ($command_args | any { |arg| $arg == "--use-latest" })
           let namespace_idx = ($command_args | enumerate | where {|item| $item.item == "--namespace"} | get 0?.index | default null)
           let namespace = if $namespace_idx != null { ($command_args | get ($namespace_idx + 1) | default "default") } else { "default" }
           let cpu_idx = ($command_args | enumerate | where {|item| $item.item == "--cpu"} | get 0?.index | default null)
           let cpu = if $cpu_idx != null { ($command_args | get ($cpu_idx + 1) | default "4") } else { "4" }
           let memory_idx = ($command_args | enumerate | where {|item| $item.item == "--memory"} | get 0?.index | default null)
           let memory = if $memory_idx != null { ($command_args | get ($memory_idx + 1) | default "4Gi") } else { "4Gi" }
           
           # Call the build-ai-web-k8s command
           if $push and $use_latest {
               build-ai-web-k8s --tag $tag --push --use-latest --namespace $namespace --cpu $cpu --memory $memory
           } else if $push {
               build-ai-web-k8s --tag $tag --push --namespace $namespace --cpu $cpu --memory $memory
           } else if $use_latest {
               build-ai-web-k8s --tag $tag --use-latest --namespace $namespace --cpu $cpu --memory $memory
           } else {
               build-ai-web-k8s --tag $tag --namespace $namespace --cpu $cpu --memory $memory
           }
       }
       "build-ai-all" => {
           # Parse flags
           let command_args = ($args | skip 1)
           let tag_idx = ($command_args | enumerate | where {|item| $item.item == "--tag"} | get 0?.index | default null)
           let tag = if $tag_idx != null { ($command_args | get ($tag_idx + 1) | default "") } else { "" }
           let push = ($command_args | any { |arg| $arg == "--push" })
           let use_latest = ($command_args | any { |arg| $arg == "--use-latest" })
           
           # Call the build-ai-all command
           if $push and $use_latest {
               build-ai-all --tag $tag --push --use-latest
           } else if $push {
               build-ai-all --tag $tag --push
           } else if $use_latest {
               build-ai-all --tag $tag --use-latest
           } else {
               build-ai-all --tag $tag
           }
       }
       _ => {
           error make { msg: $"($color_red)Unknown command: '($command)'. Must be 'migrate', 'dev-up', 'dev-down', 'dev-env-*', 'dev-env-force-cleanup', 'update-workflow', 'register-workflow', 'build-image', 'build-all-images', 'build-code-server', 'build-ai-api', 'build-ai-web', 'build-ai-web-k8s', or 'build-ai-all'.($color_reset)" }
       }
   }
}
