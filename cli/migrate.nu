# Manage database migrations
export def run-migrate [
    action: string # The migration action to perform: up, latest, down, or status
    --ee           # Run combined CE + EE migrations (latest, down, status)
] {
    let project_root = find-project-root

    if $ee {
        if not ($action in ["latest", "down", "status"]) {
            error make { msg: $"($env.ALGA_COLOR_RED)--ee is only supported with 'latest', 'down', or 'status' actions($env.ALGA_COLOR_RESET)" }
        }

        # Map action to npm script name
        let npm_script = match $action {
            "latest" => "migrate:ee",
            "down" => "migrate:ee:down",
            "status" => "migrate:ee:status"
        }

        print $"($env.ALGA_COLOR_CYAN)Running CE + EE migrations ($action)...($env.ALGA_COLOR_RESET)"
        let result = do {
            cd $project_root
            npm -w server run $npm_script | complete
        }

        if $result.exit_code == 0 {
            if not ($result.stdout | is-empty) {
                print $result.stdout
            }
            print $"($env.ALGA_COLOR_GREEN)CE + EE migrations ($action) completed successfully.($env.ALGA_COLOR_RESET)"
            return
        }

        if not ($result.stderr | is-empty) {
            print $"($env.ALGA_COLOR_RED)($result.stderr)($env.ALGA_COLOR_RESET)"
        }
        error make { msg: $"($env.ALGA_COLOR_RED)CE + EE migrations ($action) failed($env.ALGA_COLOR_RESET)", code: $result.exit_code }
    }

    match $action {
        "up" => {
            print $"($env.ALGA_COLOR_CYAN)Running next pending database migration...($env.ALGA_COLOR_RESET)"
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd ($project_root | path join "server")
                npx knex migrate:up --knexfile knexfile.cjs --env migration | complete # Use migrate:up
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout # Keep knex output as is
                print $"($env.ALGA_COLOR_GREEN)Migration 'up' completed successfully.($env.ALGA_COLOR_RESET)"
            } else {
                print $"($env.ALGA_COLOR_RED)($result.stderr)($env.ALGA_COLOR_RESET)"
                error make { msg: $"($env.ALGA_COLOR_RED)Migration 'up' failed($env.ALGA_COLOR_RESET)", code: $result.exit_code }
            }
        }
        "latest" => { # Add separate case for 'latest'
            print $"($env.ALGA_COLOR_CYAN)Running all pending database migrations...($env.ALGA_COLOR_RESET)"
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd ($project_root | path join "server")
                npx knex migrate:latest --knexfile knexfile.cjs --env migration | complete # Use migrate:latest
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout # Keep knex output as is
                print $"($env.ALGA_COLOR_GREEN)Migrations 'latest' completed successfully.($env.ALGA_COLOR_RESET)"
            } else {
                print $"($env.ALGA_COLOR_RED)($result.stderr)($env.ALGA_COLOR_RESET)"
                error make { msg: $"($env.ALGA_COLOR_RED)Migration 'latest' failed($env.ALGA_COLOR_RESET)", code: $result.exit_code }
            }
        }
        "down" => {
            print $"($env.ALGA_COLOR_CYAN)Reverting last database migration...($env.ALGA_COLOR_RESET)"
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd ($project_root | path join "server")
                npx knex migrate:down --knexfile knexfile.cjs --env migration | complete
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout # Keep knex output as is
                print $"($env.ALGA_COLOR_GREEN)Migration reverted successfully.($env.ALGA_COLOR_RESET)"
            } else {
                print $"($env.ALGA_COLOR_RED)($result.stderr)($env.ALGA_COLOR_RESET)"
                error make { msg: $"($env.ALGA_COLOR_RED)Migration revert failed($env.ALGA_COLOR_RESET)", code: $result.exit_code }
            }
        }
        "status" => {
            print $"($env.ALGA_COLOR_CYAN)Checking migration status...($env.ALGA_COLOR_RESET)"
            # Change to the server directory and run the knex command
            # Capture stdout and stderr
            let result = do {
                cd ($project_root | path join "server")
                npx knex migrate:status --knexfile knexfile.cjs --env migration | complete
            }

            # Print output or error
            if $result.exit_code == 0 {
                print $result.stdout # Keep knex output as is
                print $"($env.ALGA_COLOR_GREEN)Migration status checked successfully.($env.ALGA_COLOR_RESET)"
            } else {
                print $"($env.ALGA_COLOR_RED)($result.stderr)($env.ALGA_COLOR_RESET)"
                error make { msg: $"($env.ALGA_COLOR_RED)Checking migration status failed($env.ALGA_COLOR_RESET)", code: $result.exit_code }
            }
        }
        _ => {
            # This case should technically not be reachable due to the type annotation
            # but it's good practice to include it.
            error make { msg: $"($env.ALGA_COLOR_RED)Unknown migration action: ($action)($env.ALGA_COLOR_RESET)" }
        }
    }
}
