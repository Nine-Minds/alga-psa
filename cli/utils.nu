# Find the project root directory by looking for key files
export def find-project-root [] {
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
            error make { msg: $"($env.ALGA_COLOR_RED)Could not find project root. Make sure you're running from within the alga-psa project directory.($env.ALGA_COLOR_RESET)" }
        }
        
        $search_dir = $parent
    }
}


# Load Database Environment Variables from server/.env
export def load-db-env [] {
    let project_root = find-project-root
    let env_path = ($project_root | path join "server" ".env")
    if not ($env_path | path exists) {
        error make { msg: $"($env.ALGA_COLOR_RED)Database environment file not found: ($env_path)($env.ALGA_COLOR_RESET)" }
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

# Parse a flag value from arguments list
export def parse-flag [
    args: list<string>   # The arguments list
    flag: string         # The flag to look for
] {
    let matches = ($args | enumerate | where { |it| $it.item == $flag })
    if ($matches | length) > 0 {
        let index = ($matches | first | get index)
        if ($index + 1) < ($args | length) {
            $args | get ($index + 1)
        } else {
            null
        }
    } else {
        null
    }
}

# Check if a flag exists in arguments list
export def check-flag [
    args: list<string>   # The arguments list
    flag: string         # The flag to check for
] {
    $flag in $args
}