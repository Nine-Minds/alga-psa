#!/usr/bin/env nu

# Alga Development CLI

# Source the other modules
source-env "colors.nu"
use "utils.nu" *
use "migrate.nu" *
use "workflows.nu" *
use "dev-env.nu" *
use "hosted-env.nu" *
use "build.nu" *
use "config.nu" *
use "tenant.nu" *
use "portal-domain.nu" *

# Main CLI entry point function
def --wrapped main [
   ...args: string   # All arguments and flags as strings
] {
   let command = ($args | get 0? | default null)
   
   # Handle help flags
   if $command in ["--help", "-h", "help"] {
       print $"($env.ALGA_COLOR_CYAN)Alga Dev CLI($env.ALGA_COLOR_RESET)"
       print "Usage:"
       print "  nu main.nu migrate <action> [--ee]"
       print "    Action: up, latest, down, status"
       print "    --ee: Run combined CE + EE migrations (latest, down, status)"
       print "    Example: nu main.nu migrate latest"
       print "    Example: nu main.nu migrate latest --ee"
       print "    Example: nu main.nu migrate status --ee"
       print "    Example: nu main.nu migrate down --ee"
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
       print "  nu main.nu hosted-env-create <branch> [--environment hosted|sebastian]     # Create hosted code-server env"
       print "  nu main.nu hosted-env-list [--environment hosted|sebastian]               # List hosted environments"
       print "  nu main.nu hosted-env-connect <branch> --canary <header> [--environment hosted|sebastian]    # Port-forward code-server"
       print "  nu main.nu hosted-env-destroy <branch> [--force] [--environment hosted|sebastian]"
       print "  nu main.nu hosted-env-status <branch> [--environment hosted|sebastian]     # Show k8s objects"
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
       print "    --client-name: Client name (defaults to tenant name)"
       print "    --password: Admin password (generated if not provided)"
       print "    --seed-onboarding: Run onboarding seeds (default: true)"
       print "    --skip-onboarding: Set onboarding_skipped flag in tenant_settings"
       print "    Example: nu main.nu create-tenant \"Test Client\" \"admin@test.com\""
       print "    Example: nu main.nu create-tenant \"Test Client\" \"admin@test.com\" --skip-onboarding"
       print "  nu main.nu list-tenants           # List all tenants"
       print ""
       print "  nu main.nu cleanup-tenant <action> [args]  # Clean up test tenant data"
       print "    Actions:"
       print "      list [--environment local|production]     # List all tenants"
       print "      inspect <id> [--environment local|production]  # Inspect tenant data"
       print "      cleanup <id> [--environment local|production] [--execute] [--preserve-tenant] [--force]"
       print ""
       print "Alternatively, source the script ('source main.nu') and run commands directly:"
       print "  run-migrate <action> [--ee]"
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
       print "  nu main.nu migrate <action> [--ee]"
       print "    Action: up, latest, down, status"
       print "    --ee: Run combined CE + EE migrations (latest, down, status)"
       print "    Example: nu main.nu migrate latest"
       print "    Example: nu main.nu migrate latest --ee"
       print "    Example: nu main.nu migrate status --ee"
       print "    Example: nu main.nu migrate down --ee"
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
       print "  nu main.nu hosted-env-create <branch> [--environment hosted|sebastian]     # Create hosted code-server env"
       print "  nu main.nu hosted-env-list [--environment hosted|sebastian]               # List hosted environments"
       print "  nu main.nu hosted-env-connect <branch> --canary <header> [--environment hosted|sebastian]    # Port-forward code-server"
       print "  nu main.nu hosted-env-destroy <branch> [--force] [--environment hosted|sebastian]"
       print "  nu main.nu hosted-env-status <branch> [--environment hosted|sebastian]     # Show k8s objects"
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
       print "  run-migrate <action> [--ee]"
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
           let command_args = ($args | skip 1)
           let ee_flag = ($command_args | any { |arg| $arg == "--ee" })
           let action_candidates = ($command_args | where { |arg| $arg != "--ee" })
           let action = ($action_candidates | get 0? | default null)

           if $action == null {
               error make { msg: $"($env.ALGA_COLOR_RED)migrate command requires an action: up, latest, down, status($env.ALGA_COLOR_RESET)" }
           }

           if ($action_candidates | length) > 1 {
               error make { msg: $"($env.ALGA_COLOR_RED)Multiple migrate actions provided. Supply one action plus optional --ee flag($env.ALGA_COLOR_RESET)" }
           }

           if not ($action in ["up", "latest", "down", "status"]) {
                error make { msg: $"($env.ALGA_COLOR_RED)Invalid migrate action '($action)'. Must be one of: up, latest, down, status($env.ALGA_COLOR_RESET)" }
           }

           if $ee_flag and not ($action in ["latest", "down", "status"]) {
               error make { msg: $"($env.ALGA_COLOR_RED)--ee is only supported with 'latest', 'down', or 'status' actions($env.ALGA_COLOR_RESET)" }
           }

           if $ee_flag {
               run-migrate $action --ee
           } else {
               run-migrate $action
           }
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
      "portal-domain" => {
          let subcommand = ($args | get 1? | default null)
          if $subcommand == null {
              error make { msg: $"($env.ALGA_COLOR_RED)portal-domain command requires a subcommand (e.g., sessions)($env.ALGA_COLOR_RESET)" }
          }

          match $subcommand {
              "sessions" => {
                  let action = ($args | get 2? | default null)
                  if $action == null {
                      error make { msg: $"($env.ALGA_COLOR_RED)portal-domain sessions requires an action (e.g., prune)($env.ALGA_COLOR_RESET)" }
                  }

                  match $action {
                      "prune" => {
                          let command_args = ($args | skip 3)
                          portal-domain-sessions-prune ...$command_args
                      }
                      _ => {
                          error make { msg: $"($env.ALGA_COLOR_RED)Unsupported portal-domain sessions action: ($action)($env.ALGA_COLOR_RESET)" }
                      }
                  }
              }
              _ => {
                  error make { msg: $"($env.ALGA_COLOR_RED)Unsupported portal-domain subcommand: ($subcommand)($env.ALGA_COLOR_RESET)" }
              }
          }
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
           let client_name = (parse-flag $args "--client-name" | default "")
           let password = (parse-flag $args "--password" | default "")
           let seed_onboarding = not (check-flag $args "--no-seed-onboarding")
           let skip_onboarding = (check-flag $args "--skip-onboarding")
           
           create-tenant $tenant_name $admin_email --first-name $first_name --last-name $last_name --client-name $client_name --password $password --seed-onboarding $seed_onboarding --skip-onboarding $skip_onboarding
       }
       "list-tenants" => {
           list-tenants
       }
       "cleanup-tenant" => {
           let action = ($args | get 1? | default null)
           
           if $action == null {
               # Show help for cleanup-tenant
               nu cli/cleanup-tenant.nu
               return
           }
           
           # Build the command arguments
           let remaining_args = ($args | skip 2 | str join " ")
           
           # Execute the cleanup-tenant script with the action and remaining arguments
           if $remaining_args == "" {
               nu cli/cleanup-tenant.nu $action
           } else {
               nu cli/cleanup-tenant.nu $action ...(($args | skip 2))
           }
       }
       # Hosted environment commands
       "hosted-env-create" => {
           let env_flag = (parse-flag $args "--environment")
           let env_short = (parse-flag $args "-e")
           let environment = if $env_flag != null { $env_flag } else { $env_short }
           let branch_state = (($args | skip 1) | reduce -f { branch: null skip_env: false } { |arg, acc|
               if $acc.skip_env {
                   { branch: $acc.branch, skip_env: false }
               } else if $arg == "--environment" or $arg == "-e" {
                   { branch: $acc.branch, skip_env: true }
               } else {
                   if $acc.branch == null {
                       { branch: $arg, skip_env: false }
                   } else {
                       $acc
                   }
               }
           })
           let branch = ($branch_state | get branch)
           if $branch == null {
               error make { msg: $"($env.ALGA_COLOR_RED)hosted-env-create requires branch argument($env.ALGA_COLOR_RESET)" }
           }
           if $environment == null {
               hosted-env-create $branch
           } else {
               hosted-env-create $branch --environment $environment
           }
       }
       "hosted-env-list" => {
           let env_flag = (parse-flag $args "--environment")
           let env_short = (parse-flag $args "-e")
           let environment = if $env_flag != null { $env_flag } else { $env_short }
           if $environment == null {
               hosted-env-list
           } else {
               hosted-env-list --environment $environment
           }
       }
       "hosted-env-connect" => {
           let env_flag = (parse-flag $args "--environment")
           let env_short = (parse-flag $args "-e")
           let environment = if $env_flag != null { $env_flag } else { $env_short }
           let canary_flag = (parse-flag $args "--canary")
           let canary_short = (parse-flag $args "-c")
           let canary = if $canary_flag != null { $canary_flag } else { $canary_short }
           let branch_state = (($args | skip 1) | reduce -f { branch: null skip_next: false } { |arg, acc|
               if $acc.skip_next {
                   { branch: $acc.branch, skip_next: false }
               } else if $arg == "--environment" or $arg == "-e" or $arg == "--canary" or $arg == "-c" {
                   { branch: $acc.branch, skip_next: true }
               } else if ($arg | str starts-with "-") {
                   $acc
               } else {
                   if $acc.branch == null {
                       { branch: $arg, skip_next: false }
                   } else {
                       $acc
                   }
               }
           })
           let branch = ($branch_state | get branch)
           if $branch == null {
                error make { msg: $"($env.ALGA_COLOR_RED)hosted-env-connect requires branch argument($env.ALGA_COLOR_RESET)" }
           }
           if $canary == null {
               error make { msg: $"($env.ALGA_COLOR_RED)hosted-env-connect requires '--canary <header_value>'.($env.ALGA_COLOR_RESET)" }
           }
           if $environment == null {
               hosted-env-connect $branch --canary $canary
           } else {
               hosted-env-connect $branch --environment $environment --canary $canary
           }
       }
       "hosted-env-destroy" => {
           let env_flag = (parse-flag $args "--environment")
           let env_short = (parse-flag $args "-e")
           let environment = if $env_flag != null { $env_flag } else { $env_short }
           let branch_state = (($args | skip 1) | reduce -f { branch: null skip_env: false } { |arg, acc|
               if $acc.skip_env {
                   { branch: $acc.branch, skip_env: false }
               } else if $arg == "--environment" or $arg == "-e" {
                   { branch: $acc.branch, skip_env: true }
               } else if $arg == "--force" {
                   $acc
               } else {
                   if $acc.branch == null {
                       { branch: $arg, skip_env: false }
                   } else {
                       $acc
                   }
               }
           })
           let branch = ($branch_state | get branch)
           if $branch == null {
               error make { msg: $"($env.ALGA_COLOR_RED)hosted-env-destroy requires branch argument($env.ALGA_COLOR_RESET)" }
           }
           let force = (check-flag $args "--force")
           if $environment == null {
               hosted-env-destroy $branch --force $force
           } else {
               hosted-env-destroy $branch --force $force --environment $environment
           }
       }
       "hosted-env-status" => {
           let env_flag = (parse-flag $args "--environment")
           let env_short = (parse-flag $args "-e")
           let environment = if $env_flag != null { $env_flag } else { $env_short }
           let branch_state = (($args | skip 1) | reduce -f { branch: null skip_env: false } { |arg, acc|
               if $acc.skip_env {
                   { branch: $acc.branch, skip_env: false }
               } else if $arg == "--environment" or $arg == "-e" {
                   { branch: $acc.branch, skip_env: true }
               } else {
                   if $acc.branch == null {
                       { branch: $arg, skip_env: false }
                   } else {
                       $acc
                   }
               }
           })
           let branch = ($branch_state | get branch)
           if $branch == null {
               error make { msg: $"($env.ALGA_COLOR_RED)hosted-env-status requires branch argument($env.ALGA_COLOR_RESET)" }
           }
           if $environment == null {
               hosted-env-status $branch
           } else {
               hosted-env-status $branch --environment $environment
           }
       }
       _ => {
           error make { msg: $"($env.ALGA_COLOR_RED)Unknown command: '($command)'. Must be 'migrate', 'dev-up', 'dev-down', 'dev-env-*', 'dev-env-force-cleanup', 'update-workflow', 'register-workflow', 'build-image', 'build-all-images', 'build-code-server', 'build-ai-api', 'build-ai-web', 'build-ai-web-k8s', 'build-ai-all', 'config', 'create-tenant', 'list-tenants', or 'cleanup-tenant'.($env.ALGA_COLOR_RESET)" }
       }
   }
}
