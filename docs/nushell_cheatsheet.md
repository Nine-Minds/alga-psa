# Nushell Development Cheatsheet

This document covers common gotchas and syntax differences when developing in Nushell, particularly for developers coming from bash or other traditional shells. These lessons learned come from building the Alga PSA CLI tool.

## Table of Contents

1. [String Interpolation](#string-interpolation)
2. [Variable Scope and Capture Issues](#variable-scope-and-capture-issues)
3. [Background Process Handling](#background-process-handling)
4. [Parentheses Escaping](#parentheses-escaping)
5. [Function Parameter Handling](#function-parameter-handling)
6. [Path Handling](#path-handling)
7. [Command Output and Error Handling](#command-output-and-error-handling)
8. [General Syntax Differences](#general-syntax-differences)

## String Interpolation

### The Problem
Nushell has different string interpolation syntax than bash, and mixing them up leads to confusing errors.

### Solution Patterns

#### ✅ Correct Nushell String Interpolation
```nu
# Use $"..." for interpolated strings with parentheses around variables
let name = "world"
print $"Hello ($name)!"

# For nested interpolation:
let pr_number = 123
let namespace = $"alga-pr-($pr_number)"
print $"($color_cyan)Creating environment for PR ($pr_number) in namespace ($namespace)($color_reset)"
```

#### ❌ Wrong Patterns (Bash-style)
```nu
# DON'T use bash-style $variable inside strings
print "Hello $name!"  # Won't interpolate

# DON'T use ${variable} syntax
print "Hello ${name}!" # Syntax error
```

#### Different Variable Reference Types
```nu
# $variable - Direct variable reference (no interpolation)
let my_var = some_value

# $(expression) - Command substitution 
let current_time = $(date now)

# $"string with (variable)" - String interpolation
let message = $"Current time is (date now)"
```

## Variable Scope and Capture Issues

### The Problem
Variables declared in outer scopes can have capture issues when used in closures or `do` blocks.

### Solution: Copy Variables to Avoid Capture Issues

#### ✅ Correct Pattern
```nu
def find-project-root [] {
    let current_dir = pwd
    mut search_dir = $current_dir
    
    loop {
        # Copy to avoid capture issue in closure
        let current_search_dir = $search_dir  
        let has_indicators = ($root_indicators | all { |indicator| 
            ($current_search_dir | path join $indicator | path exists)
        })
        
        # ... rest of logic
    }
}
```

#### ❌ Problematic Pattern
```nu
loop {
    # Direct use of mut variable in closure can cause issues
    let has_indicators = ($root_indicators | all { |indicator| 
        ($search_dir | path join $indicator | path exists)  # Capture issue!
    })
}
```

### Variable Mutation
```nu
# Use 'mut' for variables that will change
mut search_dir = $current_dir
$search_dir = ($search_dir | path dirname)

# Use 'let' for immutable variables
let project_root = find-project-root
```

## Background Process Handling

### The Problem
Nushell's `&` operator doesn't work like bash's backgrounding operator.

### Solution: Use `bash -c` for Background Processes

#### ✅ Correct Pattern (Fallback to Bash)
```nu
# Use bash -c for proper backgrounding
print "Starting port forwarding processes..."
bash -c $"kubectl port-forward -n ($namespace) svc/service1 8080:8080 &"
bash -c $"kubectl port-forward -n ($namespace) svc/service2 3001:3000 &"

# Kill background processes
bash -c $"pkill -f 'kubectl port-forward.*dev-env-pr-($pr_number)'"
```

#### ❌ Wrong Pattern (Nushell Native)
```nu
# This doesn't work the same way as bash
kubectl port-forward -n $namespace svc/service1 8080:8080 &  # Won't background properly
```

#### Alternative: Using `do` with Background Tasks
```nu
# For some cases, you can use 'do' blocks with job management
let result = do {
    cd $project_root
    docker compose up -d | complete
}
```

## Parentheses Escaping

### The Problem
Parentheses in strings need to be escaped when they're not part of variable interpolation.

### Solution: Escape Parentheses in Display Text

#### ✅ Correct Pattern
```nu
# Escape parentheses that are meant to be literal
print $"($color_cyan)Local Access \(Port Forward\):($color_reset)"
print $"  Connect: dev-env-connect ($pr_number) [--port-forward] [--code-server]"
```

#### ❌ Wrong Pattern
```nu
# Unescaped parentheses may be interpreted as interpolation
print $"($color_cyan)Local Access (Port Forward):($color_reset)"  # May cause issues
```

## Function Parameter Handling

### The Problem
Nushell requires `--wrapped` for functions that need to handle dynamic arguments with flags.

### Solution: Use `--wrapped` for CLI Argument Parsing

#### ✅ Correct Pattern
```nu
# Use --wrapped for main function that processes CLI args
def --wrapped main [
   ...args: string   # All arguments and flags as strings
] {
   let command = ($args | get 0? | default null)
   let command_args = ($args | skip 1)
   
   # Parse flags manually
   let detached = ($command_args | any { |arg| $arg == "--detached" or $arg == "-d" })
   let edition_idx = ($command_args | enumerate | where {|item| $item.item == "--edition"} | get 0?.index | default null)
}
```

#### ❌ Wrong Pattern
```nu
# Without --wrapped, flag parsing is problematic
def main [
   command?: string,
   arg2?: string  # Can't handle dynamic flags
] {
   # Limited argument handling
}
```

### Optional Parameters and Defaults
```nu
# Use '?' for optional parameters and 'default' for fallbacks
def dev-env-status [
    pr_number?: int    # Optional parameter
] {
    if ($pr_number | is-empty) {
        dev-env-list
        return
    }
    # ... rest of function
}

# Use default values in parameter definitions
def dev-up [
    --detached (-d) # Boolean flag
    --edition (-e): string = "ce" # String with default value
] {
    # Function body
}
```

## Path Handling

### The Problem
Path operations in Nushell use a different API than traditional shells.

### Solution: Use Nushell Path Commands

#### ✅ Correct Pattern
```nu
# Use path commands for file operations
let project_root = find-project-root
let workflow_file = ($project_root | path join "server" "src" "lib" "workflows" $"($workflow_name).ts")

# Check if path exists
if not ($workflow_file | path exists) {
    error make { msg: $"File not found: ($workflow_file)" }
}

# Get parent directory
let parent = ($search_dir | path dirname)
```

#### ❌ Wrong Pattern (Bash-style)
```nu
# Don't use bash-style path operations
let workflow_file = "$project_root/server/src/lib/workflows/$workflow_name.ts"  # Won't interpolate
```

## Command Output and Error Handling

### The Problem
Nushell handles command output and errors differently than bash.

### Solution: Use `complete` and Proper Error Handling

#### ✅ Correct Pattern
```nu
# Use 'complete' to capture both stdout and stderr
let result = do {
    cd ($project_root | path join "server")
    npx knex migrate:up --knexfile knexfile.cjs --env migration | complete
}

# Check exit code and handle output
if $result.exit_code == 0 {
    print $result.stdout
    print $"($color_green)Migration completed successfully.($color_reset)"
} else {
    print $"($color_red)($result.stderr)($color_reset)"
    error make { msg: $"Migration failed", code: $result.exit_code }
}
```

#### Error Creation
```nu
# Use 'error make' for custom errors
error make { 
    msg: $"($color_red)Unknown command: '($command)'($color_reset)" 
}

# With error codes
error make { 
    msg: $"($color_red)Migration failed($color_reset)", 
    code: $result.exit_code 
}
```

## General Syntax Differences

### Conditional Checks
```nu
# String length checks
if ($line | str trim | str length) > 0 {
    # Process non-empty line
}

# Check if value is in list
if not ($edition in ["ce", "ee"]) {
    error make { msg: "Invalid edition" }
}

# Check for empty values
if ($pr_number | is-empty) {
    return
}
```

### Data Processing Pipelines
```nu
# Use pipeline operations for data transformation
open $env_path
| lines
| each { |line| $line | str trim }
| where { |line| not ($line | str starts-with '#') and ($line | str length) > 0 }
| split column "=" -n 2
| rename key value
| reduce -f {} { |item, acc| $acc | upsert $item.key $item.value }
```

### Environment Variables
```nu
# Set environment for command execution
with-env { PGPASSWORD: $db_env.DB_PASSWORD_ADMIN } {
    $sql_update | psql -h $db_env.DB_HOST -p $db_env.DB_PORT -U $db_env.DB_USER_ADMIN -d $db_env.DB_NAME_SERVER -f -
}
```

### Match Statements
```nu
# Use match for multiple conditions
match $action {
    "up" => {
        print "Running migration up..."
        # migration logic
    }
    "down" => {
        print "Running migration down..."
        # revert logic
    }
    _ => {
        error make { msg: $"Unknown action: ($action)" }
    }
}
```

## Key Takeaways for Bash Users

1. **String interpolation**: Use `$"text (variable) more text"` instead of `"text $variable more text"`
2. **Variables**: Use `let` for immutable, `mut` for mutable, copy variables to avoid closure capture issues
3. **Background processes**: Fall back to `bash -c` for proper backgrounding when needed
4. **Parentheses**: Escape literal parentheses as `\(` and `\)` in interpolated strings
5. **Command output**: Use `| complete` to capture both stdout and stderr
6. **Path operations**: Use `path join`, `path exists`, `path dirname` instead of string concatenation
7. **Function parameters**: Use `--wrapped` and `...args` for flexible CLI argument handling
8. **Error handling**: Use `error make` instead of `exit` or `return` with error codes

## Common Debug Tips

1. **Check variable values**: Use `print $variable` to debug variable contents
2. **Test string interpolation**: Start simple with `$"Hello (variable)"` patterns
3. **Pipeline debugging**: Add `| debug` to see data flowing through pipelines
4. **Command testing**: Test commands with `| complete` to see full output structure
5. **Scope issues**: If variables aren't accessible in closures, copy them to local variables first

This cheatsheet covers the main gotchas encountered while developing the Alga PSA CLI. When in doubt, check the [official Nushell documentation](https://www.nushell.sh/book/) for more detailed explanations.