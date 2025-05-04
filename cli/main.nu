# Alga Development CLI

# Manage database migrations
def migrate [
    action: string # The migration action to perform: up, latest, down, or status
] {
    match $action {
        "up" => {
            print "Running next pending database migration..."
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd server
                npx knex migrate:up --knexfile knexfile.cjs --env migration | complete # Use migrate:up
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout
                print "Migration 'up' completed successfully."
            } else {
                print $result.stderr
                error make { msg: "Migration 'up' failed", code: $result.exit_code }
            }
        }
        "latest" => { # Add separate case for 'latest'
            print "Running all pending database migrations..."
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd server
                npx knex migrate:latest --knexfile knexfile.cjs --env migration | complete # Use migrate:latest
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout
                print "Migrations 'latest' completed successfully."
            } else {
                print $result.stderr
                error make { msg: "Migration 'latest' failed", code: $result.exit_code }
            }
        }
        "down" => {
            print "Reverting last database migration..."
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd server
                npx knex migrate:down --knexfile knexfile.cjs --env migration | complete
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout
                print "Migration reverted successfully."
            } else {
                print $result.stderr
                error make { msg: "Migration revert failed", code: $result.exit_code }
            }
        }
        "status" => {
            print "Checking migration status..."
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd server
                npx knex migrate:status --knexfile knexfile.cjs --env migration | complete
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout
                print "Migration status checked successfully."
            } else {
                print $result.stderr
                error make { msg: "Checking migration status failed", code: $result.exit_code }
            }
        }
        _ => {
            # This case should technically not be reachable due to the type annotation
            # but it's good practice to include it.
            error make { msg: $"Unknown migration action: ($action)" }
        }
    }
}

# Alga Development CLI Entry Point
# Handles command-line arguments to run migration actions.
def main [
    command?: string, # The command to run (should be 'migrate')
    action?: string   # The migration action (up, down, status)
] {
    # Check if the correct command and an action were provided
    if $command == null or $command != "migrate" or $action == null {
        print "Alga Dev CLI"
        print "Usage: nu main.nu migrate <action>"
        print "Action can be: up, latest, down, status"
        print "Example: nu main.nu migrate latest"
        print "\nAlternatively, source the script ('source main.nu') and run 'migrate <action>' directly."
        return # Exit if arguments are wrong/missing
    }

    # Validate the action before calling migrate
    # Validate the action before calling migrate
    if not ($action in ["up", "latest", "down", "status"]) {
         error make { msg: $"Invalid action '($action)'. Must be one of: up, latest, down, status" }
    }

    # Call the migrate command with the validated action
    migrate $action
}