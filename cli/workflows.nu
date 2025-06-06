# Update System Workflow Registration
# Reads a workflow definition file and updates the latest version in the database.
export def update-workflow [
   workflow_name: string # The BASE name of the workflow (e.g., 'invoice-sync', 'qboCustomerSyncWorkflow'), without path or .ts extension
] {
   let project_root = find-project-root
   print $"($env.ALGA_COLOR_CYAN)Updating system workflow registration for '($workflow_name)'...($env.ALGA_COLOR_RESET)"

   # Construct file path (assuming .ts extension)
   let workflow_file = ($project_root | path join "server" "src" "lib" "workflows" $"($workflow_name).ts")

   # Check if file exists
   if not ($workflow_file | path exists) {
       error make { msg: $"($env.ALGA_COLOR_RED)Workflow file not found: ($workflow_file)($env.ALGA_COLOR_RESET)" }
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

   print $"($env.ALGA_COLOR_CYAN)Executing database update...($env.ALGA_COLOR_RESET)"

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
            print $"($env.ALGA_COLOR_GREEN)System workflow '($workflow_name)' updated successfully.($env.ALGA_COLOR_RESET)"
       } else if ($result.stdout | str contains "UPDATE 0") {
            print $"($env.ALGA_COLOR_YELLOW)Warning: No matching system workflow named '($workflow_name)' found or no update needed.($env.ALGA_COLOR_RESET)"
       } else {
            print $result.stdout # Print other potential output
            print $"($env.ALGA_COLOR_YELLOW)System workflow '($workflow_name)' update command executed, but result unclear.($env.ALGA_COLOR_RESET)"
       }
   } else {
       print $"($env.ALGA_COLOR_RED)($result.stderr)($env.ALGA_COLOR_RESET)"
       error make { msg: $"($env.ALGA_COLOR_RED)System workflow update failed($env.ALGA_COLOR_RESET)", code: $result.exit_code }
   }
}
# Register or Add New Version for a System Workflow
# Creates the registration if it doesn't exist, then adds a new version
# based on the file content, marking it as the current version.
export def register-workflow [
    workflow_name: string # The BASE name of the workflow (e.g., 'invoice-sync', 'qboCustomerSyncWorkflow'), without path or .ts extension
] {
    let project_root = find-project-root
    print $"($env.ALGA_COLOR_CYAN)Registering/Versioning system workflow '($workflow_name)'...($env.ALGA_COLOR_RESET)"

    # Construct file path
    let workflow_file = ($project_root | path join "server" "src" "lib" "workflows" $"($workflow_name).ts")
    if not ($workflow_file | path exists) {
        error make { msg: $"($env.ALGA_COLOR_RED)Workflow file not found: ($workflow_file)($env.ALGA_COLOR_RESET)" }
    }
    let file_content = open $workflow_file

    # Load Database Environment Variables using the helper function
    let db_env = load-db-env

    # --- Check if latest version already matches file content ---
    print $"($env.ALGA_COLOR_CYAN)Checking current version in database...($env.ALGA_COLOR_RESET)"
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
            print $"($env.ALGA_COLOR_GREEN)Workflow '($workflow_name)' is already up-to-date with the current file content. No changes made.($env.ALGA_COLOR_RESET)"
            return
        } else {
            print $"($env.ALGA_COLOR_CYAN)Current version differs or does not exist. Proceeding with registration/versioning...($env.ALGA_COLOR_RESET)"
        }
    } else {
        # If the check fails (e.g., workflow not registered yet), proceed with registration
        print $"($env.ALGA_COLOR_YELLOW)Warning: Could not retrieve current workflow definition (Exit Code: ($check_result.exit_code)). Proceeding with registration/versioning...($env.ALGA_COLOR_RESET)"
        print $"($env.ALGA_COLOR_RED)($check_result.stderr)($env.ALGA_COLOR_RESET)"
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

    print $"($env.ALGA_COLOR_CYAN)Executing database transaction...($env.ALGA_COLOR_RESET)"
 
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
        print $"($env.ALGA_COLOR_GREEN)System workflow '($workflow_name)' registered/versioned successfully (($version_info)).($env.ALGA_COLOR_RESET)"
    } else {
        print $"($env.ALGA_COLOR_RED)($result.stderr)($env.ALGA_COLOR_RESET)"
        # Note: psql might not output specific errors easily here if ON_ERROR_STOP is used
        error make { msg: $"($env.ALGA_COLOR_RED)System workflow registration/versioning failed. Transaction rolled back.($env.ALGA_COLOR_RESET)", code: $result.exit_code }
    }
}