# Helper function to sanitize branch names for Kubernetes resources
def sanitize-branch-name [branch: string] {
    # Sanitize branch name for Kubernetes namespace (lowercase, alphanumeric and hyphens only)
    # First replace slashes with hyphens, then clean up any other special characters
    let sanitized_base = ($branch | str replace -a "/" "-" | str downcase | str replace -a "[^a-z0-9-]" "-" | str replace -r "^-+|-+$" "" | str replace -r "-+" "-")
    
    # Ensure Helm release name stays under 53 character limit
    # Release name format: "alga-dev-{sanitized_branch}" = 9 + sanitized_branch length
    let max_branch_length = 43  # 53 - 9 = 44, but we need 43 to be safe
    if ($sanitized_base | str length) > $max_branch_length {
        # For long names, take first part and add hash of full name for uniqueness
        let hash_suffix = ($sanitized_base | hash sha256 | str substring 0..7)
        let prefix_length = $max_branch_length - 9  # 9 chars for "-" + 8-char hash
        let prefix = ($sanitized_base | str substring 0..$prefix_length)
        $"($prefix)-($hash_suffix)"
    } else {
        $sanitized_base
    }
}

# Start development environment with Docker Compose
export def dev-up [
    --detached (-d) # Run in detached mode (background)
    --edition (-e): string = "ce" # Edition to start: ce (community) or ee (enterprise)
] {
    let project_root = find-project-root
    
    # Validate edition parameter
    if not ($edition in ["ce", "ee"]) {
        error make { msg: $"($env.ALGA_COLOR_RED)Invalid edition '($edition)'. Must be 'ce' (community) or 'ee' (enterprise).($env.ALGA_COLOR_RESET)" }
    }
    
    let edition_file = if $edition == "ce" { "docker-compose.prebuilt.ce.yaml" } else { "docker-compose.ee.yaml" }
    let base_file = if $edition == "ce" { "docker-compose.prebuilt.base.yaml" } else { "docker-compose.base.yaml" }
    let edition_name = if $edition == "ce" { "Community Edition" } else { "Enterprise Edition" }
    
    print $"($env.ALGA_COLOR_CYAN)Starting development environment (($edition_name))...($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Project root: ($project_root)($env.ALGA_COLOR_RESET)"
    
    if $detached {
        let command = $"docker compose -f ($base_file) -f ($edition_file) --env-file server/.env up --build -d"
        print $"($env.ALGA_COLOR_YELLOW)Running: ($command)($env.ALGA_COLOR_RESET)"
        
        let result = do {
            cd $project_root
            docker compose -f $base_file -f $edition_file --env-file server/.env up -d | complete
        }
        
        if $result.exit_code == 0 {
            print $"($env.ALGA_COLOR_GREEN)Development environment (($edition_name)) started in background.($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_CYAN)Access the application at: http://localhost:3000($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_CYAN)View logs with: docker compose logs -f($env.ALGA_COLOR_RESET)"
        } else {
            print $"($env.ALGA_COLOR_RED)($result.stderr)($env.ALGA_COLOR_RESET)"
            error make { msg: $"($env.ALGA_COLOR_RED)Failed to start development environment($env.ALGA_COLOR_RESET)", code: $result.exit_code }
        }
    } else {
        let command = $"docker compose -f ($base_file) -f ($edition_file) --env-file server/.env up"
        print $"($env.ALGA_COLOR_YELLOW)Running: ($command)($env.ALGA_COLOR_RESET)"
        
        # Stream output directly without capturing
        cd $project_root
        docker compose -f $base_file -f $edition_file --env-file server/.env up --build
    }
}

# Stop development environment
export def dev-down [] {
    let project_root = find-project-root
    print $"($env.ALGA_COLOR_CYAN)Stopping development environment...($env.ALGA_COLOR_RESET)"
    
    let result = do {
        cd $project_root
        docker compose down | complete
    }
    
    if $result.exit_code == 0 {
        print $result.stdout
        print $"($env.ALGA_COLOR_GREEN)Development environment stopped.($env.ALGA_COLOR_RESET)"
    } else {
        print $"($env.ALGA_COLOR_RED)($result.stderr)($env.ALGA_COLOR_RESET)"
        error make { msg: $"($env.ALGA_COLOR_RED)Failed to stop development environment($env.ALGA_COLOR_RESET)", code: $result.exit_code }
    }
}

# Create development environment for branch
# 
# Environment variables for AI automation (read from .env file or shell environment):
#   CUSTOM_OPENAI_API_KEY: Required - API key for LLM provider (e.g., OpenRouter key)
#   CUSTOM_OPENAI_BASE_URL: Optional - API endpoint (default: https://openrouter.ai/api/v1)
#   CUSTOM_OPENAI_MODEL: Optional - Model name (default: google/gemini-2.5-flash-preview-05-20)
#
export def dev-env-create [
    branch: string     # Git branch name
    --edition: string = "ee"  # Edition: ce or ee
    --use-latest = false # Use 'latest' tag instead of unique tag
    --checkout = true  # Checkout the branch locally
    --from-tag: string = "latest" # Deploy from existing image tag instead of building
] {
    let project_root = find-project-root
    
    # Validate edition parameter
    if not ($edition in ["ce", "ee"]) {
        error make { msg: $"($env.ALGA_COLOR_RED)Invalid edition '($edition)'. Must be 'ce' (community) or 'ee' (enterprise).($env.ALGA_COLOR_RESET)" }
    }
    
    # Check for mutually exclusive options
    if ($from_tag | str length) > 0 and $use_latest {
        error make { msg: $"($env.ALGA_COLOR_RED)Cannot use both --from-tag and --use-latest. Choose one or the other.($env.ALGA_COLOR_RESET)" }
    }
    
    # Sanitize branch name for Kubernetes namespace and Helm release name length limits
    let sanitized_branch = (sanitize-branch-name $branch)
    
    let namespace = $"alga-dev-($sanitized_branch)"
    
    # Checkout the branch if requested
    if $checkout {
        print $"($env.ALGA_COLOR_CYAN)Checking out branch: ($branch)($env.ALGA_COLOR_RESET)"
        let checkout_result = do {
            cd $project_root
            git checkout $branch | complete
        }
        
        if $checkout_result.exit_code != 0 {
            # Try to fetch and checkout if branch doesn't exist locally
            print $"($env.ALGA_COLOR_YELLOW)Branch not found locally, fetching from remote...($env.ALGA_COLOR_RESET)"
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
                    print $"($env.ALGA_COLOR_YELLOW)Warning: Could not checkout branch ($branch). Continuing with current branch.($env.ALGA_COLOR_RESET)"
                }
            } else {
                print $"($env.ALGA_COLOR_YELLOW)Warning: Branch ($branch) not found in remote. Continuing with current branch.($env.ALGA_COLOR_RESET)"
            }
        }
    }
    
    # Find available ports for external access
    print $"($env.ALGA_COLOR_CYAN)Finding available ports for external access...($env.ALGA_COLOR_RESET)"
    
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
        error make { msg: $"($env.ALGA_COLOR_RED)Could not find available ports for services($env.ALGA_COLOR_RESET)" }
    }
    
    print $"($env.ALGA_COLOR_GREEN)Assigned external ports:($env.ALGA_COLOR_RESET)"
    print $"  Main App:     ($app_port)"
    print $"  Code Server:  ($code_server_port)"
    print $"  Code App:     ($code_app_port)"
    print $"  AI Web:       ($ai_web_port)"
    
    # Determine image tag and whether to build
    let tag_info = if ($from_tag | str length) > 0 {
        # User explicitly provided a tag, so don't build
        { tag: $from_tag, build: false, reason: $"using provided tag '($from_tag)'" }
    } else if $use_latest {
        # User wants to build and tag as 'latest'
        { tag: "latest", build: true, reason: "building and using 'latest' tag" }
    } else {
        # Default behavior: use existing 'latest' tag without building
        { tag: "latest", build: false, reason: "using default 'latest' tag" }
    }

    let image_tag = $tag_info.tag
    let should_build = $tag_info.build
    let reason = $tag_info.reason
    
    # Build image only if determined necessary
    if $should_build {
        print $"($env.ALGA_COLOR_CYAN)Building image before deployment... ($reason)($env.ALGA_COLOR_RESET)"
        # The --use-latest flag in build-image handles tagging with both SHA and 'latest'
        if $image_tag == "latest" {
            build-image $edition --use-latest --push
        } else {
            build-image $edition --tag $image_tag --push
        }
    } else {
        print $"($env.ALGA_COLOR_CYAN)Skipping build - ($reason)($env.ALGA_COLOR_RESET)"
    }
    
    print $"($env.ALGA_COLOR_CYAN)Creating development environment for branch: ($branch)($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Sanitized name: ($sanitized_branch)($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Edition: ($edition)($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)AI Automation: enabled($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Namespace: ($namespace)($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Image Tag: ($image_tag)($env.ALGA_COLOR_RESET)"
    
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
            print $"($env.ALGA_COLOR_YELLOW)Warning: Namespace ($namespace) is stuck in Terminating state.($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_CYAN)Attempting to force cleanup...($env.ALGA_COLOR_RESET)"
            
            # Force cleanup the stuck namespace
            let force_cleanup = do {
                kubectl delete namespace $namespace --grace-period=0 --force | complete
            }
            
            if $force_cleanup.exit_code == 0 {
                print $"($env.ALGA_COLOR_GREEN)Stuck namespace cleaned up. Proceeding with creation...($env.ALGA_COLOR_RESET)"
                sleep 5sec  # Give it a moment to fully clear
            } else {
                print $"($env.ALGA_COLOR_RED)Failed to cleanup stuck namespace. Manual intervention required.($env.ALGA_COLOR_RESET)"
                print $"($env.ALGA_COLOR_YELLOW)Try running: kubectl delete namespace ($namespace) --grace-period=0 --force($env.ALGA_COLOR_RESET)"
                return
            }
        } else {
            print $"($env.ALGA_COLOR_YELLOW)Warning: Environment for branch ($branch) already exists in namespace ($namespace)($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_YELLOW)Use 'dev-env-destroy ($branch)' to remove it first if you want to recreate it.($env.ALGA_COLOR_RESET)"
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
        print $"($env.ALGA_COLOR_CYAN)Loading environment variables from ($home_env_file)...($env.ALGA_COLOR_RESET)"
        let env_vars = (open $home_env_file
            | lines
            | each { |line| $line | str trim }
            | where { |line| not ($line | str starts-with '#') and ($line | str length) > 0 and ($line | str contains '=') }
            | split column "=" -n 2
            | rename key value
            | update key {|it| $it.key | str trim }
            | update value {|it| if ($it.value | is-empty) { "" } else { $it.value | str trim | str trim -c '"' | str trim -c "'" } }
            | reduce -f {} { |item, acc| $acc | upsert $item.key $item.value })
        
        # Load all variables from .env, overwriting existing ones from the environment
        load-env $env_vars
    }

    # Get LLM configuration from environment variables
    let custom_openai_api_key = ($env.CUSTOM_OPENAI_API_KEY? | default "")
    let custom_openai_base_url = ($env.CUSTOM_OPENAI_BASE_URL? | default "https://openrouter.ai/api/v1")
    let custom_openai_model = ($env.CUSTOM_OPENAI_MODEL? | default "google/gemini-2.5-flash-preview-05-20")
    
    # Show warning if API key is not set
    if ($custom_openai_api_key | str length) == 0 {
        print $"($env.ALGA_COLOR_YELLOW)Warning: CUSTOM_OPENAI_API_KEY environment variable not set. AI automation may not work.($env.ALGA_COLOR_RESET)"
        print $"($env.ALGA_COLOR_YELLOW)Set the environment variable in your .env file or export CUSTOM_OPENAI_API_KEY=your-key-here($env.ALGA_COLOR_RESET)"
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
        print $"($env.ALGA_COLOR_CYAN)Deploying Helm chart...($env.ALGA_COLOR_RESET)"
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
            print $"($env.ALGA_COLOR_RED)Helm deployment failed:($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_RED)($helm_result.stderr)($env.ALGA_COLOR_RESET)"
            let error_msg = $"Failed to deploy development environment: ($helm_result.stderr)"
            error make { msg: $"($env.ALGA_COLOR_RED)($error_msg)($env.ALGA_COLOR_RESET)", code: $helm_result.exit_code }
        } else if $helm_result.exit_code != 0 {
            # Helm deployment had issues but resources are deployed - try upgrade to trigger hooks
            print $"($env.ALGA_COLOR_YELLOW)Initial deployment had issues, attempting upgrade to ensure hooks run...($env.ALGA_COLOR_RESET)"
            let upgrade_result = do {
                cd $project_root
                helm upgrade $"alga-dev-($sanitized_branch)" ./helm -f helm/values-dev-env.yaml -f $temp_values_file -n $namespace | complete
            }
            
            if $upgrade_result.exit_code == 0 {
                print $"($env.ALGA_COLOR_GREEN)Upgrade successful - hooks should have run for database initialization.($env.ALGA_COLOR_RESET)"
            } else {
                print $"($env.ALGA_COLOR_YELLOW)Warning: Upgrade also had issues. Database may not be initialized.($env.ALGA_COLOR_RESET)"
            }
        }
        
        # Show warnings but don't treat as errors
        if $helm_result.exit_code != 0 and not $has_real_error {
            print $"($env.ALGA_COLOR_YELLOW)Helm completed with warnings - ignoring:($env.ALGA_COLOR_RESET)"
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
        print $"($env.ALGA_COLOR_GREEN)Helm deployment completed successfully.($env.ALGA_COLOR_RESET)"
        
        # Wait for deployments to be ready
        print $"($env.ALGA_COLOR_CYAN)Waiting for deployments to be ready...($env.ALGA_COLOR_RESET)"
        let wait_result = do {
            kubectl wait --for=condition=available --timeout=300s deployment -l app.kubernetes.io/instance=$"alga-dev-($sanitized_branch)" -n $namespace | complete
        }
        
        if $wait_result.exit_code == 0 {
            print $"($env.ALGA_COLOR_GREEN)All deployments are ready!($env.ALGA_COLOR_RESET)"
            
            # Show environment status
            dev-env-status $branch
        } else {
            print $"($env.ALGA_COLOR_YELLOW)Warning: Some deployments may still be starting. Use 'dev-env-status ($branch)' to check progress.($env.ALGA_COLOR_RESET)"
        }
        
    } catch { |err|
        print $"($env.ALGA_COLOR_RED)Error during deployment: ($err)($env.ALGA_COLOR_RESET)"
    }
    
    # Clean up temporary files
    if ($temp_values_file | path exists) {
        rm $temp_values_file
    }
}

# List active development environments
export def dev-env-list [] {
    print $"($env.ALGA_COLOR_CYAN)Active development environments:($env.ALGA_COLOR_RESET)"
    
    let namespaces_result = do {
        kubectl get namespaces -l type=dev-environment -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.labels.branch}{"\n"}{end}' | complete
    }
    
    if $namespaces_result.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Failed to list environments: ($namespaces_result.stderr)($env.ALGA_COLOR_RESET)"
        return
    }
    
    let environments = ($namespaces_result.stdout | lines | where ($it | str trim | str length) > 0)
    
    if ($environments | length) == 0 {
        print $"($env.ALGA_COLOR_YELLOW)No active development environments found.($env.ALGA_COLOR_RESET)"
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
export def dev-env-connect [
    branch: string     # Branch name to connect to
] {
    # Sanitize branch name for namespace lookup
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"alga-dev-($sanitized_branch)"
    
    # Check if environment exists
    let env_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $env_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Environment for branch ($branch) not found.($env.ALGA_COLOR_RESET)"
        print $"($env.ALGA_COLOR_YELLOW)Use 'dev-env-list' to see available environments.($env.ALGA_COLOR_RESET)"
        return
    }
    
    print $"($env.ALGA_COLOR_CYAN)Connecting to development environment for branch: ($branch)($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Setting up port forwarding...($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_YELLOW)This will run in foreground. Press Ctrl+C to stop.($env.ALGA_COLOR_RESET)"
        
        # Find available ports dynamically at connect time
        print $"($env.ALGA_COLOR_CYAN)Finding available ports for port forwarding...($env.ALGA_COLOR_RESET)"
        
        # Function to find a free port (same as in dev-env-create)
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
            print $"($env.ALGA_COLOR_RED)Could not find available ports for services($env.ALGA_COLOR_RESET)"
            return
        }
        
        print $"($env.ALGA_COLOR_GREEN)Found available ports:($env.ALGA_COLOR_RESET)"
        print $"  Main App:     ($app_port)"
        print $"  Code Server:  ($code_server_port)"
        print $"  Code App:     ($code_app_port)"
        print $"  AI Web:       ($ai_web_port)"
        
        # Start port forwarding processes with found ports
        print $"($env.ALGA_COLOR_CYAN)Starting port forwarding processes...($env.ALGA_COLOR_RESET)"
        
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
            print $"($env.ALGA_COLOR_YELLOW)Warning: Some port forwarding processes may not have started properly($env.ALGA_COLOR_RESET)"
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
                        print $"($env.ALGA_COLOR_RED)Errors in ($log_file):($env.ALGA_COLOR_RESET)"
                        print $content
                    }
                }
            }
        }
            
            # Display the URLs
            print $"($env.ALGA_COLOR_CYAN)Port forwarding setup:($env.ALGA_COLOR_RESET)"
            print $"  Code Server:        http://localhost:($code_server_port)"
            print $"    Password: alga-dev"
            print $"  PSA App \(main\):     http://localhost:($app_port)"
            print $"  PSA App \(in code\):  http://localhost:($code_app_port)"
            print $"  AI Web:             http://localhost:($ai_web_port)"
            
            # Update NEXTAUTH_URL in .env files for proper authentication
            print $"($env.ALGA_COLOR_CYAN)Configuring NEXTAUTH_URL in .env files...($env.ALGA_COLOR_RESET)"
            
            # Helper function to update .env file
            def update-env-file [pod_name: string, nextauth_url: string, description: string] {
                print $"  Updating ($description): ($pod_name)"
                
                # Check if NEXTAUTH_URL already exists in .env file
                let env_check = do {
                    kubectl exec -n $namespace $pod_name -- grep -E "^NEXTAUTH_URL=" .env 2>/dev/null | complete
                }
                
                if $env_check.exit_code == 0 and ($env_check.stdout | str trim | str length) > 0 {
                    # NEXTAUTH_URL exists, check if it's different
                    let current_url = ($env_check.stdout | str trim | split column "=" | get column2.0)
                    
                    if $current_url != $nextauth_url {
                        print $"    ($env.ALGA_COLOR_YELLOW)Warning: .env already contains NEXTAUTH_URL=($current_url)($env.ALGA_COLOR_RESET)"
                        print $"    ($env.ALGA_COLOR_YELLOW)This may indicate another developer is using this environment.($env.ALGA_COLOR_RESET)"
                        print $"    ($env.ALGA_COLOR_YELLOW)Updating to your port configuration: ($nextauth_url)($env.ALGA_COLOR_RESET)"
                        
                        # Update existing entry
                        kubectl exec -n $namespace $pod_name -- sed -i "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=($nextauth_url)|" .env | complete
                    } else {
                        print $"    ($env.ALGA_COLOR_GREEN)NEXTAUTH_URL already correctly set to ($nextauth_url)($env.ALGA_COLOR_RESET)"
                    }
                } else {
                    # NEXTAUTH_URL doesn't exist, add it
                    print $"    ($env.ALGA_COLOR_CYAN)Adding NEXTAUTH_URL=($nextauth_url) to .env file($env.ALGA_COLOR_RESET)"
                    kubectl exec -n $namespace $pod_name -- sh -c $"echo 'NEXTAUTH_URL=($nextauth_url)' >> .env" | complete
                }
            }
            
            # Get pod names and update their .env files
            let main_app_pods = do {
                kubectl get pods -n $namespace -l "app.kubernetes.io/component!=code-server,app.kubernetes.io/component!=ai-automation-api,app.kubernetes.io/component!=ai-automation-web" -o jsonpath='{.items[*].metadata.name}' --ignore-not-found | complete
            }
            
            let code_server_pods = do {
                kubectl get pods -n $namespace -l "app.kubernetes.io/component=code-server" -o jsonpath='{.items[*].metadata.name}' --ignore-not-found | complete
            }
            
            # Update main app pods
            if $main_app_pods.exit_code == 0 and not ($main_app_pods.stdout | is-empty) {
                let main_pods = ($main_app_pods.stdout | str trim | split row ' ')
                for pod in $main_pods {
                    if ($pod | str trim | str length) > 0 {
                        update-env-file $pod $"http://localhost:($app_port)" "main app"
                    }
                }
            }
            
            # Update code server pods
            if $code_server_pods.exit_code == 0 and not ($code_server_pods.stdout | is-empty) {
                let code_pods = ($code_server_pods.stdout | str trim | split row ' ')
                for pod in $code_pods {
                    if ($pod | str trim | str length) > 0 {
                        update-env-file $pod $"http://localhost:($code_app_port)" "code server"
                    }
                }
            }
            
            print $"($env.ALGA_COLOR_GREEN)NEXTAUTH_URL configuration completed.($env.ALGA_COLOR_RESET)"
        
        print $"($env.ALGA_COLOR_GREEN)Port forwarding active!($env.ALGA_COLOR_RESET)"
        
        # Wait for user to stop
        input "Press Enter to stop port forwarding..."
        
        # Kill all kubectl port-forward processes
        bash -c $"pkill -f 'kubectl port-forward.*alga-dev-($sanitized_branch)'"
        
        # Clean up log files
        rm -f $"/tmp/pf-code-server-($sanitized_branch).log"
        rm -f $"/tmp/pf-main-app-($sanitized_branch).log" 
        rm -f $"/tmp/pf-code-app-($sanitized_branch).log"
        rm -f $"/tmp/pf-ai-web-($sanitized_branch).log"
        
        print $"($env.ALGA_COLOR_CYAN)Port forwarding stopped.($env.ALGA_COLOR_RESET)"
}

# Destroy development environment
export def dev-env-destroy [
    branch: string     # Branch name to destroy
    --force            # Force deletion without confirmation
] {
    # Sanitize branch name for namespace lookup
    let sanitized_branch = (sanitize-branch-name $branch)
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
        print $"($env.ALGA_COLOR_YELLOW)Environment for branch ($branch) not found or already destroyed.($env.ALGA_COLOR_RESET)"
        return
    }
    
    if not $force {
        print $"($env.ALGA_COLOR_YELLOW)This will permanently destroy the development environment for branch ($branch).($env.ALGA_COLOR_RESET)"
        print $"($env.ALGA_COLOR_YELLOW)All data in the environment will be lost.($env.ALGA_COLOR_RESET)"
        let confirmation = (input $"Type 'yes' to confirm destruction: ")
        
        if $confirmation != "yes" {
            print $"($env.ALGA_COLOR_CYAN)Destruction cancelled.($env.ALGA_COLOR_RESET)"
            return
        }
    }
    
    print $"($env.ALGA_COLOR_CYAN)Destroying development environment for branch: ($branch)...($env.ALGA_COLOR_RESET)"
    
    # Step 1: Kill any stuck hook jobs first
    print $"($env.ALGA_COLOR_CYAN)1. Cleaning up stuck hook jobs...($env.ALGA_COLOR_RESET)"
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
    print $"($env.ALGA_COLOR_CYAN)2. Scaling down ai-api deployment...($env.ALGA_COLOR_RESET)"
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
    print $"($env.ALGA_COLOR_CYAN)Waiting for ai-api pods to terminate...($env.ALGA_COLOR_RESET)"
    mut wait_retries = 0
    while $wait_retries < 30 { # Wait for up to 60 seconds
        let remaining_pods = (get-ai-pods)
        if ($remaining_pods | is-empty) {
            print $"\n($env.ALGA_COLOR_GREEN)All targeted ai-api pods have been terminated.($env.ALGA_COLOR_RESET)"
            break
        } else {
            let remaining_str = ($remaining_pods | str join ", ")
            print -n $"\r  Waiting... remaining: ($remaining_str)"
            sleep 2sec
            $wait_retries = $wait_retries + 1
        }
    }
    if $wait_retries >= 30 {
        print $"\n($env.ALGA_COLOR_YELLOW)Warning: Pods did not terminate gracefully. Forcing deletion...($env.ALGA_COLOR_RESET)"
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
    print $"($env.ALGA_COLOR_CYAN)3. Checking for other stuck resources...($env.ALGA_COLOR_RESET)"
    
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
    print $"($env.ALGA_COLOR_CYAN)4. Checking for stuck persistent volumes...($env.ALGA_COLOR_RESET)"
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
    print $"($env.ALGA_COLOR_CYAN)5. Locating and removing Helm release...($env.ALGA_COLOR_RESET)"
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
            print $"  ($env.ALGA_COLOR_GREEN)Helm release removed successfully from ($namespace).($env.ALGA_COLOR_RESET)"
        } else {
            print $"  ($env.ALGA_COLOR_YELLOW)Warning: Helm uninstall had issues, trying force cleanup...($env.ALGA_COLOR_RESET)"
            # Force delete the release by removing finalizers
            helm uninstall $release_name -n $namespace --timeout=30s --no-hooks | complete
        }
    } else if $helm_check_default.exit_code == 0 {
        print $"  Found release in default namespace, removing..."
        let helm_result = do {
            helm uninstall $release_name -n default --timeout=60s --no-hooks --cascade=background | complete
        }
        
        if $helm_result.exit_code == 0 {
            print $"  ($env.ALGA_COLOR_GREEN)Helm release removed successfully from default namespace.($env.ALGA_COLOR_RESET)"
        } else {
            print $"  ($env.ALGA_COLOR_YELLOW)Warning: Helm uninstall had issues, trying force cleanup...($env.ALGA_COLOR_RESET)"
            # Force delete the release by removing finalizers
            helm uninstall $release_name -n default --timeout=30s --no-hooks | complete
        }
    } else {
        print $"  No Helm release found for ($release_name) in either namespace."
    }
    
    # Step 6: Clean up remaining resources systematically
    print $"($env.ALGA_COLOR_CYAN)6. Cleaning up remaining resources...($env.ALGA_COLOR_RESET)"
    
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
    print $"($env.ALGA_COLOR_CYAN)7. Force cleaning up persistent volumes...($env.ALGA_COLOR_RESET)"
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
    print $"($env.ALGA_COLOR_CYAN)8. Deleting namespace...($env.ALGA_COLOR_RESET)"
    
    # First try to patch out any finalizers on the namespace itself
    print $"  Removing namespace finalizers..."
    kubectl patch namespace $namespace -p '{\"metadata\":{\"finalizers\":null}}' --type=merge | complete
    
    # Short timeout for initial deletion attempt
    let namespace_result = do {
        kubectl delete namespace $namespace --timeout=30s | complete
    }
    
    if $namespace_result.exit_code == 0 {
        print $"($env.ALGA_COLOR_GREEN)Development environment for branch ($branch) destroyed successfully.($env.ALGA_COLOR_RESET)"
    } else {
        print $"  ($env.ALGA_COLOR_YELLOW)Warning: Standard namespace deletion had issues. Attempting force cleanup...($env.ALGA_COLOR_RESET)"
        
        # Wait a moment for any pending deletions to complete
        sleep 2sec
        
        # Check if namespace still exists
        let ns_check = do {
            kubectl get namespace $namespace | complete
        }
        
        if $ns_check.exit_code != 0 {
            print $"  ($env.ALGA_COLOR_GREEN)Namespace was deleted during wait period.($env.ALGA_COLOR_RESET)"
        } else {
            print $"  Namespace still exists, forcing deletion..."
            # Final attempt to delete namespace with grace period 0 and shorter timeout
            let force_namespace_result = do {
                kubectl delete namespace $namespace --grace-period=0 --force --timeout=20s | complete
            }
            
            if $force_namespace_result.exit_code == 0 {
                print $"  ($env.ALGA_COLOR_GREEN)Namespace force deleted successfully.($env.ALGA_COLOR_RESET)"
            } else {
                print $"  ($env.ALGA_COLOR_YELLOW)Force delete timed out or failed. Checking if deletion is in progress...($env.ALGA_COLOR_RESET)"
                
                # Check final status
                let final_ns_check = do {
                    kubectl get namespace $namespace | complete
                }
                
                if $final_ns_check.exit_code != 0 {
                    print $"  ($env.ALGA_COLOR_GREEN)Namespace deletion completed.($env.ALGA_COLOR_RESET)"
                } else {
                    print $"  ($env.ALGA_COLOR_RED)Namespace still exists. May require manual cleanup.($env.ALGA_COLOR_RESET)"
                    print $"  ($env.ALGA_COLOR_YELLOW)The namespace may be stuck due to remaining finalizers.($env.ALGA_COLOR_RESET)"
                    print $"  ($env.ALGA_COLOR_YELLOW)Try: kubectl patch namespace ($namespace) -p '{\\\"metadata\\\":{\\\"finalizers\\\":null}}' --type=merge($env.ALGA_COLOR_RESET)"
                    print $"  ($env.ALGA_COLOR_YELLOW)Then: kubectl delete namespace ($namespace) --grace-period=0 --force($env.ALGA_COLOR_RESET)"
                }
            }
        }
    }
    
    # Step 9: Final verification and cleanup
    print $"($env.ALGA_COLOR_CYAN)9. Final verification...($env.ALGA_COLOR_RESET)"
    let final_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $final_check.exit_code == 0 {
        print $"  ($env.ALGA_COLOR_YELLOW)Namespace still exists, attempting final cleanup...($env.ALGA_COLOR_RESET)"
        # Last resort - try to remove any stuck finalizers on the namespace itself
        kubectl patch namespace $namespace -p '{\"metadata\":{\"finalizers\":null}}' --type=merge | complete
        kubectl delete namespace $namespace --grace-period=0 --force | complete
    } else {
        print $"  ($env.ALGA_COLOR_GREEN)Namespace successfully removed.($env.ALGA_COLOR_RESET)"
    }
}

# Force cleanup stuck development environment resources
export def dev-env-force-cleanup [
    branch: string     # Branch name to force cleanup
] {
    # Sanitize branch name for namespace lookup
    let sanitized_branch = (sanitize-branch-name $branch)
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
    
    print $"($env.ALGA_COLOR_CYAN)Force cleaning up development environment for branch: ($branch)...($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_YELLOW)This will aggressively remove all resources and may take some time.($env.ALGA_COLOR_RESET)"
    
    # Remove Helm release from both potential namespaces
    print $"($env.ALGA_COLOR_CYAN)Removing Helm releases...($env.ALGA_COLOR_RESET)"
    let release_name = $"alga-dev-($sanitized_branch)"
    
    # Check and remove from environment namespace
    let helm_check_ns = do { helm status $release_name -n $namespace | complete }
    if $helm_check_ns.exit_code == 0 {
        print $"($env.ALGA_COLOR_CYAN)Removing release from ($namespace)...($env.ALGA_COLOR_RESET)"
        helm uninstall $release_name -n $namespace | complete
    }
    
    # Check and remove from default namespace
    let helm_check_default = do { helm status $release_name -n default | complete }
    if $helm_check_default.exit_code == 0 {
        print $"($env.ALGA_COLOR_CYAN)Removing release from default namespace...($env.ALGA_COLOR_RESET)"
        helm uninstall $release_name -n default | complete
    }
    
    # Force stop ai-api pods first (known to cause stuck namespaces)
    print $"($env.ALGA_COLOR_CYAN)Force stopping ai-api pods...($env.ALGA_COLOR_RESET)"
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
        print $"($env.ALGA_COLOR_CYAN)Waiting for ai-api pods to terminate...($env.ALGA_COLOR_RESET)"
        mut wait_retries = 0
        while $wait_retries < 15 { # Wait for up to 30 seconds
            let remaining_pods = (get-ai-pods)
            if ($remaining_pods | is-empty) {
                print $"\n($env.ALGA_COLOR_GREEN)All targeted ai-api pods have been terminated.($env.ALGA_COLOR_RESET)"
                break
            } else {
                let remaining_text = ($remaining_pods | str join ', ')
                print -n $"\r  Waiting... \\(remaining: ($remaining_text)\\)"
                sleep 2sec
                $wait_retries = $wait_retries + 1
            }
        }
        if $wait_retries >= 15 {
            print $"\n($env.ALGA_COLOR_YELLOW)Warning: Some ai-api pods may not have terminated correctly. Continuing...($env.ALGA_COLOR_RESET)"
        }
    }

    # Delete all resources in the namespace
    print $"($env.ALGA_COLOR_CYAN)Deleting all namespace resources...($env.ALGA_COLOR_RESET)"
    kubectl delete all --all -n $namespace --timeout=30s | complete
    kubectl delete pvc --all -n $namespace --timeout=30s | complete
    kubectl delete configmaps,secrets --all -n $namespace --timeout=30s | complete
    kubectl delete ingress --all -n $namespace --timeout=30s | complete
    
    # Remove finalizers from persistent volumes if they exist
    print $"($env.ALGA_COLOR_CYAN)Checking for stuck persistent volumes...($env.ALGA_COLOR_RESET)"
    let pvs_result = do {
        kubectl get pv -o json | complete
    }
    
    if $pvs_result.exit_code == 0 {
        # This would require jq to parse JSON properly, so we'll skip PV cleanup for now
        print $"($env.ALGA_COLOR_YELLOW)Note: If PVs are stuck, you may need to manually remove finalizers($env.ALGA_COLOR_RESET)"
    }
    
    # Force delete the namespace
    print $"($env.ALGA_COLOR_CYAN)Force deleting namespace...($env.ALGA_COLOR_RESET)"
    
    # Remove namespace finalizers first
    print $"  Removing namespace finalizers..."
    kubectl patch namespace $namespace -p '{\"metadata\":{\"finalizers\":null}}' --type=merge | complete
    
    let namespace_result = do {
        kubectl delete namespace $namespace --grace-period=0 --force --timeout=30s | complete
    }
    
    if $namespace_result.exit_code == 0 {
        print $"($env.ALGA_COLOR_GREEN)Force cleanup completed successfully.($env.ALGA_COLOR_RESET)"
    } else {
        # Wait and check if deletion completed
        print $"  Waiting for namespace deletion to complete..."
        sleep 3sec
        
        let final_check = do {
            kubectl get namespace $namespace | complete
        }
        
        if $final_check.exit_code != 0 {
            print $"($env.ALGA_COLOR_GREEN)Namespace deletion completed after wait.($env.ALGA_COLOR_RESET)"
        } else {
            print $"($env.ALGA_COLOR_YELLOW)Some resources may still need manual cleanup.($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_YELLOW)Check with: kubectl get all -A | grep ($sanitized_branch)($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_YELLOW)Or try: kubectl patch namespace ($namespace) -p '{\\\"metadata\\\":{\\\"finalizers\\\":null}}' --type=merge($env.ALGA_COLOR_RESET)"
        }
    }
}

# Get environment status and URLs
export def dev-env-status [
    branch?: string    # Optional branch name, shows all if omitted
] {
    if ($branch | is-empty) {
        dev-env-list
        return
    }
    
    # Sanitize branch name for namespace lookup
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"alga-dev-($sanitized_branch)"
    
    # Check if environment exists
    let env_check = do {
        kubectl get namespace $namespace | complete
    }
    
    if $env_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Environment for branch ($branch) not found.($env.ALGA_COLOR_RESET)"
        print $"($env.ALGA_COLOR_YELLOW)Use 'dev-env-list' to see available environments.($env.ALGA_COLOR_RESET)"
        return
    }
    
    print $"($env.ALGA_COLOR_CYAN)Development Environment Status - Branch: ($branch)($env.ALGA_COLOR_RESET)"
    print "═══════════════════════════════════════════════════════"
    
    # Get deployment status
    print $"($env.ALGA_COLOR_CYAN)Deployments:($env.ALGA_COLOR_RESET)"
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
        print $"  ($env.ALGA_COLOR_RED)Error getting deployment status($env.ALGA_COLOR_RESET)"
    }
    
    print ""
    
    # Get service URLs
    print $"($env.ALGA_COLOR_CYAN)Service URLs:($env.ALGA_COLOR_RESET)"
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
        print $"  ($env.ALGA_COLOR_YELLOW)No ingress URLs found($env.ALGA_COLOR_RESET)"
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
        
        print $"($env.ALGA_COLOR_CYAN)Assigned External Ports:($env.ALGA_COLOR_RESET)"
        print $"  Main App:        localhost:($ports_data.app)"
        print $"  Code Server:     localhost:($ports_data.codeServer)"
        print $"  Code App:        localhost:($ports_data.codeApp)"
        print $"  AI Web:          localhost:($ports_data.aiWeb)"
        print ""
    }
    
    # Port forward instructions
    print $"($env.ALGA_COLOR_CYAN)Local Access - Port Forward:($env.ALGA_COLOR_RESET)"
    print $"  Run: dev-env-connect ($branch)"
    print $"  This will use the pre-assigned ports shown above"
    
    print ""
    print $"($env.ALGA_COLOR_CYAN)Management Commands:($env.ALGA_COLOR_RESET)"
    print $"  Connect:  dev-env-connect ($branch)"
    print $"  Destroy:  dev-env-destroy ($branch) [--force]"
}
