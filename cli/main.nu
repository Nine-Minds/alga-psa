# Alga Development CLI

# --- Color Constants ---
let color_reset = (ansi reset)
let color_green = (ansi green)
let color_yellow = (ansi yellow)
let color_red = (ansi red)
let color_cyan = (ansi cyan)
# --- End Color Constants ---


# Manage database migrations
def migrate [
    action: string # The migration action to perform: up, latest, down, or status
] {
    match $action {
        "up" => {
            print $"($color_cyan)Running next pending database migration...($color_reset)"
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd server
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
                cd server
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
                cd server
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
                cd server
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
    let env_path = "server/.env"
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
   print $"($color_cyan)Updating system workflow registration for '($workflow_name)'...($color_reset)"

   # Construct file path (assuming .ts extension)
   let workflow_file = $"server/src/lib/workflows/($workflow_name).ts"

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
       cd server
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
    print $"($color_cyan)Registering/Versioning system workflow '($workflow_name)'...($color_reset)"

    # Construct file path
    let workflow_file = $"server/src/lib/workflows/($workflow_name).ts"
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
        cd server
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
        cd server
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

# Alga Development CLI Entry Point
# Handles command-line arguments to run migration or workflow actions.
def main [
   command?: string, # The command to run ('migrate' or 'update-workflow')
   arg2?: string     # The action for 'migrate' or the BASE workflow_name for workflow commands
] {
   # Basic usage check
   if $command == null or $arg2 == null {
       print $"($color_cyan)Alga Dev CLI($color_reset)"
       print "Usage:"
       print "  nu main.nu migrate <action>"
       print "    Action: up, latest, down, status"
       print "    Example: nu main.nu migrate latest"
       print ""
       print "  nu main.nu update-workflow <base_workflow_name> # Update latest version definition"
       print "    Example: nu main.nu update-workflow invoice-sync"
       print ""
       print "  nu main.nu register-workflow <base_workflow_name> # Add new version (creates registration if needed)"
       print "    Example: nu main.nu register-workflow customer-sync"
       print "\nAlternatively, source the script ('source main.nu') and run commands directly:"
       print "  migrate <action>"
       print "  update-workflow <workflow_name>"
       print "  register-workflow <workflow_name>"
       return # Exit if arguments are missing
   }

   # Route command
   match $command {
       "migrate" => {
           # Validate the migrate action
           if not ($arg2 in ["up", "latest", "down", "status"]) {
                error make { msg: $"($color_red)Invalid migrate action '($arg2)'. Must be one of: up, latest, down, status($color_reset)" }
           }
           # Call the migrate command
           migrate $arg2
       }
       "update-workflow" => {
           # No specific validation here, the function handles file existence etc.
           # Call the update-workflow command
           update-workflow $arg2
       }
       "register-workflow" => {
           # No specific validation here, the function handles file existence etc.
           # Call the register-workflow command
           register-workflow $arg2
       }
       _ => {
           error make { msg: $"($color_red)Unknown command: '($command)'. Must be 'migrate', 'update-workflow', or 'register-workflow'.($color_reset)" }
       }
   }
}