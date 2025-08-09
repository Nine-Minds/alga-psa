#!/usr/bin/env nu

# Alga Development CLI

# Source the other modules
source-env "colors.nu"
use "utils.nu" *
use "migrate.nu" *
use "workflows.nu" *
use "dev-env.nu" *
use "build.nu" *
use "config.nu" *
use "tenant.nu" *

# Main CLI entry point function
def --wrapped main [
   ...args: string   # All arguments and flags as strings
] {
   let command = ($args | get 0? | default null)
   
   # Handle help flags
   if $command in ["--help", "-h", "help"] {
       print $"($env.ALGA_COLOR_CYAN)Alga Dev CLI($env.ALGA_COLOR_RESET)"
       print "Usage:"
       print "  nu main.nu migrate <action>"
       print "    Action: up, latest, down, status"
       print "    Example: nu main.nu migrate latest"
       print ""
       print "  nu main.nu -- dev-up [--detached] [--edition ce|ee]  # Start development environment"
       print "  nu main.nu dev-down               # Stop development environment"
       print ""
       print "  nu main.nu dev-env-create <branch> [--edition ce|ee] [--use-latest] [--checkout] [--from-tag <tag>] [--author-name <name>] [--author-email <email>]"
       print "    Create on-demand development environment for branch"
       print "    --use-latest: Use 'latest' tag instead of unique tag (avoids cache issues by default)"
       print "    --checkout: Checkout the branch locally (default: true)"
       print "    --from-tag: Deploy from existing image tag instead of building (mutually exclusive with --use-latest)"
       print "    --author-name: Git author name for commits (e.g., \"John Doe\")"
       print "    --author-email: Git author email for commits (e.g., \"john@example.com\")"
       print "    Example: nu main.nu dev-env-create my-feature --edition ee"
       print "    Example: nu main.nu dev-env-create my-feature --from-tag v1.2.3"
       print "    Example: nu main.nu dev-env-create my-feature --author-name \"John Doe\" --author-email \"john@example.com\""
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
       print "  nu main.nu config init [--force]  # Initialize CLI configuration"
       print "    Set up default author information and preferences"
       print "    Example: nu main.nu config init"
       print "  nu main.nu config show            # Display current configuration"
       print "  nu main.nu config get <key>       # Get a specific config value"
       print "    Example: nu main.nu config get dev_env.author.name"
       print "  nu main.nu config set <key> <value>  # Set a specific config value"
       print "    Example: nu main.nu config set dev_env.author.email \"john@example.com\""
       print ""
       print "  nu main.nu create-tenant <name> <email> [options]  # Create a new tenant"
       print "    --first-name: Admin user's first name (default: Admin)"
       print "    --last-name: Admin user's last name (default: User)"
       print "    --company-name: Company name (defaults to tenant name)"
       print "    --password: Admin password (generated if not provided)"
       print "    --seed-onboarding: Run onboarding seeds (default: true)"
       print "    --skip-onboarding: Set onboarding_skipped flag in tenant_settings"
       print "    Example: nu main.nu create-tenant \"Test Company\" \"admin@test.com\""
       print "    Example: nu main.nu create-tenant \"Test Company\" \"admin@test.com\" --skip-onboarding"
       print "  nu main.nu list-tenants           # List all tenants"
       print "  nu main.nu delete-tenant <id> [--force]  # Delete a tenant"
       print "    Example: nu main.nu delete-tenant test-tenant-id --force"
       print ""
       print "Alternatively, source the script ('source main.nu') and run commands directly:"
       print "  run-migrate <action>"
       print "  dev-up [--detached] [--edition ce|ee]"
       print "  dev-down"
       print "  update-workflow <workflow_name>"
       print "  register-workflow <workflow_name>"
       print "  dev-env-create <branch> [options]"
       print "  dev-env-list, dev-env-connect, dev-env-destroy, dev-env-status"
       return
   }
   
   # Basic usage check
   if $command == null {
       print $"($env.ALGA_COLOR_CYAN)Alga Dev CLI($env.ALGA_COLOR_RESET)"
       print "Usage:"
       print "  nu main.nu migrate <action>"
       print "    Action: up, latest, down, status"
       print "    Example: nu main.nu migrate latest"
       print ""
       print "  nu main.nu -- dev-up [--detached] [--edition ce|ee]  # Start development environment"
       print "  nu main.nu dev-down               # Stop development environment"
       print ""
       print "  nu main.nu dev-env-create <branch> [--edition ce|ee] [--use-latest] [--checkout] [--from-tag <tag>] [--author-name <name>] [--author-email <email>]"
       print "    Create on-demand development environment for branch"
       print "    --use-latest: Use 'latest' tag instead of unique tag (avoids cache issues by default)"
       print "    --checkout: Checkout the branch locally (default: true)"
       print "    --from-tag: Deploy from existing image tag instead of building (mutually exclusive with --use-latest)"
       print "    --author-name: Git author name for commits (e.g., \"John Doe\")"
       print "    --author-email: Git author email for commits (e.g., \"john@example.com\")"
       print "    Example: nu main.nu dev-env-create my-feature --edition ee"
       print "    Example: nu main.nu dev-env-create my-feature --from-tag v1.2.3"
       print "    Example: nu main.nu dev-env-create my-feature --author-name \"John Doe\" --author-email \"john@example.com\""
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
       print "  nu main.nu config init [--force]  # Initialize CLI configuration"
       print "    Set up default author information and preferences"
       print "    Example: nu main.nu config init"
       print "  nu main.nu config show            # Display current configuration"
       print "  nu main.nu config get <key>       # Get a specific config value"
       print "    Example: nu main.nu config get dev_env.author.name"
       print "  nu main.nu config set <key> <value>  # Set a specific config value"
       print "    Example: nu main.nu config set dev_env.author.email \"john@example.com\""
       print "\nAlternatively, source the script ('source main.nu') and run commands directly:"
       print "  run-migrate <action>"
       print "  dev-up [--detached] [--edition ce|ee]"
       print "  dev-down"
       print "  update-workflow <workflow_name>"
       print "  register-workflow <workflow_name>"
       print "  dev-env-create <branch> [options]"
       print "  dev-env-list, dev-env-connect, dev-env-destroy, dev-env-status"
       print "  init-config, show-config, get-config-value, set-config-value"
       return # Exit if arguments are missing
   }
   
   # Route command
   match $command {
       "migrate" => {
           let action = ($args | get 1? | default null)
           if $action == null {
               error make { msg: $"($env.ALGA_COLOR_RED)migrate command requires an action: up, latest, down, status($env.ALGA_COLOR_RESET)" }
           }
           # Validate the migrate action
           if not ($action in ["up", "latest", "down", "status"]) {
                error make { msg: $"($env.ALGA_COLOR_RED)Invalid migrate action '($action)'. Must be one of: up, latest, down, status($env.ALGA_COLOR_RESET)" }
           }
           # Call the migrate command
           run-migrate $action
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
               error make { msg: $"($env.ALGA_COLOR_RED)dev-env-create command requires a branch name($env.ALGA_COLOR_RESET)" }
           }
           
           # Parse flags
           let command_args = ($args | skip 2)
           
           let edition_idx = ($command_args | enumerate | where {|item| $item.item == "--edition"} | get 0?.index | default null)
           let edition = if $edition_idx != null { 
               ($command_args | get ($edition_idx + 1) | default "ee")
           } else {
               "ee"
           }
           
           let from_tag_idx = ($command_args | enumerate | where {|item| $item.item == "--from-tag"} | get 0?.index | default null)
           let from_tag = if $from_tag_idx != null { 
               ($command_args | get ($from_tag_idx + 1) | default "latest")
           } else {
               "latest"
           }
           
           let author_name_idx = ($command_args | enumerate | where {|item| $item.item == "--author-name"} | get 0?.index | default null)
           let author_name = if $author_name_idx != null { 
               ($command_args | get ($author_name_idx + 1) | default "")
           } else {
               ""
           }
           
           let author_email_idx = ($command_args | enumerate | where {|item| $item.item == "--author-email"} | get 0?.index | default null)
           let author_email = if $author_email_idx != null { 
               ($command_args | get ($author_email_idx + 1) | default "")
           } else {
               ""
           }
           
           let use_latest = ($command_args | any { |arg| $arg == "--use-latest" })
           let checkout = not ($command_args | any { |arg| $arg == "--no-checkout" })
           
           # Call the dev-env-create command
           dev-env-create $branch --edition $edition --use-latest=$use_latest --checkout=$checkout --from-tag $from_tag --author-name $author_name --author-email $author_email
       }
       "dev-env-list" => {
           dev-env-list
       }
       "dev-env-connect" => {
           let branch = ($args | get 1? | default null)
           if $branch == null {
               error make { msg: $"($env.ALGA_COLOR_RED)dev-env-connect command requires a branch name($env.ALGA_COLOR_RESET)" }
           }
           
           # Call the dev-env-connect command (port forwarding is now always enabled)
           dev-env-connect $branch
       }
       "dev-env-destroy" => {
           let branch = ($args | get 1? | default null)
           if $branch == null {
               error make { msg: $"($env.ALGA_COLOR_RED)dev-env-destroy command requires a branch name($env.ALGA_COLOR_RESET)" }
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
               error make { msg: $"($env.ALGA_COLOR_RED)dev-env-force-cleanup command requires a branch name($env.ALGA_COLOR_RESET)" }
           }
           # Call the dev-env-force-cleanup command
           dev-env-force-cleanup $branch
       }
       "update-workflow" => {
           let workflow_name = ($args | get 1? | default null)
           if $workflow_name == null {
               error make { msg: $"($env.ALGA_COLOR_RED)update-workflow command requires a workflow name($env.ALGA_COLOR_RESET)" }
           }
           # Call the update-workflow command
           update-workflow $workflow_name
       }
       "register-workflow" => {
           let workflow_name = ($args | get 1? | default null)
           if $workflow_name == null {
               error make { msg: $"($env.ALGA_COLOR_RED)register-workflow command requires a workflow name($env.ALGA_COLOR_RESET)" }
           }
           # Call the register-workflow command
           register-workflow $workflow_name
       }
       "build-image" => {
           let edition = ($args | get 1? | default null)
           if $edition == null {
               error make { msg: $"($env.ALGA_COLOR_RED)build-image command requires an edition (ce|ee)($env.ALGA_COLOR_RESET)" }
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
       "config" => {
           let subcommand = ($args | get 1? | default null)
           
           if $subcommand == null {
               print $"($env.ALGA_COLOR_RED)config command requires a subcommand: init, show, get, set($env.ALGA_COLOR_RESET)"
               return
           }
           
           match $subcommand {
               "init" => {
                   let force = ($args | skip 2 | any { |arg| $arg == "--force" })
                   if $force {
                       init-config --force
                   } else {
                       init-config
                   }
               }
               "show" => {
                   show-config
               }
               "get" => {
                   let key = ($args | get 2? | default null)
                   if $key == null {
                       error make { msg: $"($env.ALGA_COLOR_RED)config get requires a key argument($env.ALGA_COLOR_RESET)" }
                   }
                   
                   let value = get-config-value $key
                   if $value == null {
                       print $"($env.ALGA_COLOR_YELLOW)Config key '($key)' not found($env.ALGA_COLOR_RESET)"
                   } else {
                       print $value
                   }
               }
               "set" => {
                   let key = ($args | get 2? | default null)
                   let value = ($args | get 3? | default null)
                   
                   if $key == null or $value == null {
                       error make { msg: $"($env.ALGA_COLOR_RED)config set requires key and value arguments($env.ALGA_COLOR_RESET)" }
                   }
                   
                   set-config-value $key $value
               }
               _ => {
                   error make { msg: $"($env.ALGA_COLOR_RED)Unknown config subcommand: '($subcommand)'. Must be 'init', 'show', 'get', or 'set'.($env.ALGA_COLOR_RESET)" }
               }
           }
       }
       "create-tenant" => {
           let tenant_name = ($args | get 1? | default null)
           let admin_email = ($args | get 2? | default null)
           
           if $tenant_name == null or $admin_email == null {
               error make { msg: $"($env.ALGA_COLOR_RED)create-tenant requires tenant name and admin email arguments($env.ALGA_COLOR_RESET)" }
           }
           
           # Parse optional flags
           let first_name = (parse-flag $args "--first-name" | default "Admin")
           let last_name = (parse-flag $args "--last-name" | default "User")
           let company_name = (parse-flag $args "--company-name" | default "")
           let password = (parse-flag $args "--password" | default "")
           let seed_onboarding = not (check-flag $args "--no-seed-onboarding")
           let skip_onboarding = (check-flag $args "--skip-onboarding")
           
           create-tenant $tenant_name $admin_email --first-name $first_name --last-name $last_name --company-name $company_name --password $password --seed-onboarding $seed_onboarding --skip-onboarding $skip_onboarding
       }
       "list-tenants" => {
           list-tenants
       }
       "delete-tenant" => {
           let tenant_id = ($args | get 1? | default null)
           
           if $tenant_id == null {
               error make { msg: $"($env.ALGA_COLOR_RED)delete-tenant requires tenant ID argument($env.ALGA_COLOR_RESET)" }
           }
           
           let force = (check-flag $args "--force")
           delete-tenant $tenant_id --force $force
       }
       _ => {
           error make { msg: $"($env.ALGA_COLOR_RED)Unknown command: '($command)'. Must be 'migrate', 'dev-up', 'dev-down', 'dev-env-*', 'dev-env-force-cleanup', 'update-workflow', 'register-workflow', 'build-image', 'build-all-images', 'build-code-server', 'build-ai-api', 'build-ai-web', 'build-ai-web-k8s', 'build-ai-all', 'config', 'create-tenant', 'list-tenants', or 'delete-tenant'.($env.ALGA_COLOR_RESET)" }
       }
   }
}
