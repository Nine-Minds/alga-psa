use "config.nu" *
use "utils.nu" *

# Helper to sanitize branch to k8s-safe and release-safe fragment
def sanitize-branch-name [branch: string] {
    let sanitized_base = ($branch | str replace -a "/" "-" | str downcase | str replace -a "[^a-z0-9-]" "-" | str replace -r "^-+|-+$" "" | str replace -r "-+" "-")
    let max_branch_length = 43  # reserve headroom for release prefix
    if ($sanitized_base | str length) > $max_branch_length {
        let hash_suffix = ($sanitized_base | hash sha256 | str substring 0..7)
        let prefix_length = $max_branch_length - 9
        let prefix = ($sanitized_base | str substring 0..$prefix_length)
        $"($prefix)-($hash_suffix)"
    } else { $sanitized_base }
}

# Show diagnostics for a Kubernetes Job: describe job, list pods, and print logs
def show-job-diagnostics [ns: string, job: string] {
    print $"($env.ALGA_COLOR_CYAN)Job describe: ($ns)/($job)($env.ALGA_COLOR_RESET)"
    (kubectl -n $ns describe job/$job | complete | get stdout) | default "" | print

    print $"($env.ALGA_COLOR_CYAN)Job events: ($ns)/($job)($env.ALGA_COLOR_RESET)"
    (kubectl -n $ns get events --field-selector $"involvedObject.kind=Job,involvedObject.name=($job)" --sort-by=.lastTimestamp | complete | get stdout) | default "" | print

    let pods_out = (kubectl -n $ns get pods -l $"job-name=($job)" -o jsonpath='{.items[*].metadata.name}' | complete)
    if $pods_out.exit_code == 0 and (not ($pods_out.stdout | str trim | is-empty)) {
        let pods = ($pods_out.stdout | str trim | split row ' ')
        for p in $pods {
            print $"($env.ALGA_COLOR_CYAN)Logs for pod: ($p)($env.ALGA_COLOR_RESET)"
            (kubectl -n $ns logs $p --all-containers=true --tail=500 | complete | get stdout) | default "" | print
        }
    } else {
        print $"($env.ALGA_COLOR_YELLOW)No pods found for job ($job) in namespace ($ns).($env.ALGA_COLOR_RESET)"
    }
}

# Create hosted environment (code-server + deps in cluster, Vault-enabled)
export def hosted-env-create [
    branch: string   # Branch name to create environment for
] {
    let project_root = find-project-root
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"alga-hosted-($sanitized_branch)"

    print $"($env.ALGA_COLOR_CYAN)Creating hosted environment for branch: ($branch) → ($namespace)($env.ALGA_COLOR_RESET)"

    # Guard if exists (and handle Terminating state)
    let existing = (kubectl get namespace $namespace | complete)
    if $existing.exit_code == 0 {
        let ns_phase = (kubectl get namespace $namespace -o jsonpath='{.status.phase}' | complete)
        if $ns_phase.exit_code == 0 and ($ns_phase.stdout | str trim) == "Terminating" {
            print $"($env.ALGA_COLOR_YELLOW)Namespace ($namespace) is Terminating. Waiting up to 20s...($env.ALGA_COLOR_RESET)"
            sleep 5sec
            let recheck = (kubectl get namespace $namespace | complete)
            if $recheck.exit_code == 0 {
                print $"($env.ALGA_COLOR_RED)Namespace still exists. Use 'hosted-env-destroy ($branch) --force' to clean up.($env.ALGA_COLOR_RESET)"
                return
            }
        } else {
            print $"($env.ALGA_COLOR_YELLOW)Environment already exists. Use 'hosted-env-destroy ($branch)' to recreate.($env.ALGA_COLOR_RESET)"
            return
        }
    }

    # Ensure namespace exists with Istio labels before any pods are created
    do {
        let ns_yaml = $"\napiVersion: v1\nkind: Namespace\nmetadata:\n  name: ($namespace)\n  labels:\n    name: ($namespace)\n    type: hosted-environment\n    istio-injection: enabled\n    istio.io/rev: default\n    branch: ($sanitized_branch)\n"
        (echo $ns_yaml | kubectl apply -f - | complete) | ignore
    }

    # Render temp values
    let safe_filename = ($branch | str replace -a "/" "-")
    let temp_values_file = $"($project_root)/temp-values-hosted-($safe_filename).yaml"
    let role_name = $"alga-psa-hosted-($namespace)"

    # Ensure a Vault role exists for this namespace so Vault Agent can auth
    def ensure-vault-role [role: string, ns: string] {
        # Prefer local vault CLI if available and authenticated
        let has_vault = (not (which vault | is-empty))
        if $has_vault {
            let read_res = (vault read auth/kubernetes/role/$role | complete)
            if $read_res.exit_code == 0 { print $"($env.ALGA_COLOR_CYAN)Vault role already exists: ($role)($env.ALGA_COLOR_RESET)"; return }
            print $"($env.ALGA_COLOR_CYAN)Creating Vault role with local vault CLI: ($role)($env.ALGA_COLOR_RESET)"
            let write_res = (vault write auth/kubernetes/role/$role bound_service_account_names=default bound_service_account_namespaces=$ns policies=alga-psa ttl=24h | complete)
            if $write_res.exit_code == 0 { return }
            print $"($env.ALGA_COLOR_YELLOW)Local vault CLI failed \(will try in-cluster\): ($write_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
        } else {
            print $"($env.ALGA_COLOR_YELLOW)Vault CLI not found locally; will try in-cluster creation.($env.ALGA_COLOR_RESET)"
        }

        # Fallback: create role from inside the cluster using a short-lived Job in msp namespace
        let suffix = ($role | hash sha256 | str substring 0..8)
        let job_name = $"vault-role-create-($suffix)"
        let job_yaml = $"
apiVersion: batch/v1
kind: Job
metadata:
  name: ($job_name)
  namespace: msp
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 120
  ttlSecondsAfterFinished: 60
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"
        traffic.sidecar.istio.io/excludeOutboundPorts: "8200"
        proxy.istio.io/config: '{"holdApplicationUntilProxyStarts": false}'
    spec:
      restartPolicy: Never
      containers:
      - name: create
        image: hashicorp/vault:1.19.0
        command: [\"/bin/sh\",\"-lc\"]
        args:
          - |
            set -euo pipefail
            echo \"Creating Vault role $ROLE for namespace $NS at $VAULT_ADDR\"
            vault write auth/kubernetes/role/$ROLE \\
              bound_service_account_names=default \\
              bound_service_account_namespaces=$NS \\
              policies=alga-psa ttl=24h
        env:
        - name: ROLE
          value: ($role)
        - name: NS
          value: ($ns)
        - name: VAULT_ADDR
          value: http://vault.vault.svc:8200
        - name: VAULT_TOKEN
          valueFrom:
            secretKeyRef:
              name: vault-credentials
              key: VAULT_TOKEN
"
        print $"($env.ALGA_COLOR_CYAN)Creating Vault role in-cluster using Job ($job_name)...($env.ALGA_COLOR_RESET)"
        (echo $job_yaml | kubectl apply -f - | complete) | ignore
        # Poll job status for up to ~180s with short intervals
        mut attempts = 0
        let max_attempts = 60
        mut done = false
        while ($attempts < $max_attempts) and (not $done) {
            let js = (kubectl -n msp get job $job_name -o jsonpath='{.status.succeeded}:{.status.failed}:{.status.active}' | complete)
            if $js.exit_code == 0 {
                let parts = ($js.stdout | str trim | split row ":")
                let s_raw = ($parts | get 0? | default "0")
                let f_raw = ($parts | get 1? | default "0")
                let a_raw = ($parts | get 2? | default "0")
                let succ = (if ($s_raw | str trim | is-empty) { 0 } else { $s_raw | into int })
                let fail = (if ($f_raw | str trim | is-empty) { 0 } else { $f_raw | into int })
                let act  = (if ($a_raw | str trim | is-empty) { 0 } else { $a_raw | into int })
                if $succ > 0 {
                    print $"($env.ALGA_COLOR_GREEN)Vault role Job completed successfully.($env.ALGA_COLOR_RESET)"
                    $done = true
                    break
                } else if $fail > 0 {
                    print $"($env.ALGA_COLOR_RED)Vault role Job reported failures. Diagnostics:($env.ALGA_COLOR_RESET)"
                    show-job-diagnostics msp $job_name
                    $done = true
                    break
                } else if $act > 0 {
                    # Still running
                    sleep 3sec
                } else {
                    # No status yet; short wait
                    sleep 2sec
                }
            } else {
                # Could be creating; wait a bit
                sleep 2sec
            }
            $attempts = $attempts + 1
        }
        if not $done {
            print $"($env.ALGA_COLOR_YELLOW)Vault role Job did not complete within timeout. Diagnostics:($env.ALGA_COLOR_RESET)"
            show-job-diagnostics msp $job_name
        }
        (kubectl -n msp delete job $job_name --ignore-not-found=true | complete) | ignore
    }

    ensure-vault-role $role_name $namespace

    let values_content = $"
# Generated values for hosted environment
hostedEnv:
  enabled: true
  branch: \"($branch)\"
  sanitizedBranch: \"($sanitized_branch)\"
  namespace: \"($namespace)\"
  repository:
    url: \"https://github.com/Nine-Minds/alga-psa.git\"
    branch: \"($branch)\"
vaultAgent:
  role: \"($role_name)\""
    
    $values_content | save -f $temp_values_file

    try {
        print $"($env.ALGA_COLOR_CYAN)Deploying Helm chart...($env.ALGA_COLOR_RESET)"
        let helm_result = do {
            cd $project_root
            helm upgrade --install $"alga-hosted-($sanitized_branch)" ./helm -f helm/values-hosted-env.yaml -f $temp_values_file -n $namespace | complete
        }

        if $helm_result.exit_code != 0 {
            let stderr_l = ($helm_result.stderr | str downcase)
            let ns_exists = ($stderr_l | str contains 'already exists')
            let benign_warn = ($stderr_l | str contains 'warning:')
            if $ns_exists or $benign_warn {
                print $"($env.ALGA_COLOR_YELLOW)Helm reported non-fatal issues; retrying with --install...($env.ALGA_COLOR_RESET)"
                let retry_install = do {
                    cd $project_root
                    helm upgrade --install $"alga-hosted-($sanitized_branch)" ./helm -f helm/values-hosted-env.yaml -f $temp_values_file -n $namespace | complete
                }
                if $retry_install.exit_code != 0 {
                    print $retry_install.stderr
                    error make { msg: $"($env.ALGA_COLOR_RED)Deployment failed after retry($env.ALGA_COLOR_RESET)", code: $retry_install.exit_code }
                }
            } else {
                print $"($env.ALGA_COLOR_RED)Helm deployment failed:($env.ALGA_COLOR_RESET)"
                print $helm_result.stderr
                error make { msg: $"($env.ALGA_COLOR_RED)Deployment failed($env.ALGA_COLOR_RESET)", code: $helm_result.exit_code }
            }
        }

        print $helm_result.stdout
        print $"($env.ALGA_COLOR_CYAN)Waiting for deployments to be ready...($env.ALGA_COLOR_RESET)"
        let wait_result = (kubectl wait --for=condition=available --timeout=300s deployment -l app.kubernetes.io/instance=$"alga-hosted-($sanitized_branch)" -n $namespace | complete)
        if $wait_result.exit_code == 0 {
            print $"($env.ALGA_COLOR_GREEN)Hosted environment ready.($env.ALGA_COLOR_RESET)"
        } else {
            print $"($env.ALGA_COLOR_YELLOW)Some deployments may still be starting.($env.ALGA_COLOR_RESET)"
        }

        print $"Run: hosted-env-connect ($branch)  # to port-forward code-server"
        print $"Run: hosted-env-status  ($branch)  # to view status"
    } catch { |err|
        print $"($env.ALGA_COLOR_RED)Error: ($err)($env.ALGA_COLOR_RESET)"
    }

    if ($temp_values_file | path exists) { rm $temp_values_file }
}

# List hosted environments
export def hosted-env-list [] {
    print $"($env.ALGA_COLOR_CYAN)Active hosted environments:($env.ALGA_COLOR_RESET)"
    let ns = (kubectl get namespaces -l type=hosted-environment -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.labels.branch}{"\n"}{end}' | complete)
    if $ns.exit_code != 0 { print $ns.stderr; return }
    let environments = ($ns.stdout | lines | where ($it | str trim | str length) > 0)
    if ($environments | length) == 0 { print $"($env.ALGA_COLOR_YELLOW)No hosted environments found.($env.ALGA_COLOR_RESET)"; return }
    print "┌────────────────────────────────────────────────────────────┐"
    print "│ Namespace                     │ Branch                    │"
    print "├────────────────────────────────────────────────────────────┤"
    for line in $environments {
        let parts = ($line | split column "\t")
        let namespace = ($parts | get column1 | get 0)
        let branch = ($parts | get column2 -i | get 0? | default "Unknown")
        print $"│ ($namespace | fill -w 28) │ ($branch | fill -w 24) │"
    }
    print "└────────────────────────────────────────────────────────────┘"
}

# Connect (port-forward) to code-server in hosted environment
export def hosted-env-connect [
    branch: string
] {
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"alga-hosted-($sanitized_branch)"

    # Ensure environment exists
    let env_check = (kubectl get namespace $namespace | complete)
    if $env_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Environment for branch ($branch) not found.($env.ALGA_COLOR_RESET)"
        print $"($env.ALGA_COLOR_YELLOW)Use 'hosted-env-list' to see available environments.($env.ALGA_COLOR_RESET)"
        return
    }

    print $"($env.ALGA_COLOR_CYAN)Connecting to hosted environment for branch: ($branch)($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Setting up port forwarding...($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_YELLOW)This runs in foreground. Press Enter to stop.($env.ALGA_COLOR_RESET)"

    # Find available ports dynamically (patterned after dev-env-connect)
    def find-free-port [start_port: int] {
        mut port = $start_port
        mut found = false
        while not $found and $port < 65535 {
            let current_port = $port
            let check_result = do { bash -c $"nc -z localhost ($current_port) 2>/dev/null" | complete }
            if $check_result.exit_code != 0 { $found = true } else { $port = $port + 1 }
        }
        if $found { $port } else { 0 }
    }

    let code_server_port = find-free-port 18080
    let code_app_port    = find-free-port ($code_server_port + 1)

    if $code_server_port == 0 or $code_app_port == 0 {
        print $"($env.ALGA_COLOR_RED)Could not find available local ports.($env.ALGA_COLOR_RESET)"
        return
    }

    print $"($env.ALGA_COLOR_GREEN)Found available ports:($env.ALGA_COLOR_RESET)"
    print $"  Code Server:  ($code_server_port)"
    print $"  Code App:     ($code_app_port)"

    # Start port forwarding in background and log output
    let pf_name = $"alga-hosted-($sanitized_branch)"
    let log_code_server = $"/tmp/pf-hosted-code-server-($sanitized_branch).log"
    let log_code_app    = $"/tmp/pf-hosted-code-app-($sanitized_branch).log"

    bash -c $"kubectl port-forward -n ($namespace) svc/($pf_name)-code-server --address=127.0.0.1 ($code_server_port):8080 > ($log_code_server) 2>&1 &"
    bash -c $"kubectl port-forward -n ($namespace) svc/($pf_name)-code-server --address=127.0.0.1 ($code_app_port):3000 > ($log_code_app) 2>&1 &"

    # Give processes time to start
    sleep 2sec

    # Verify background processes started
    let pf_check = do { bash -c $"ps aux | grep -E 'kubectl port-forward.*($pf_name)-code-server' | grep -v grep | wc -l" | complete }
    if ($pf_check.stdout | str trim | into int) < 2 {
        print $"($env.ALGA_COLOR_YELLOW)Warning: Port-forwarding may not have started correctly. Checking logs...($env.ALGA_COLOR_RESET)"
        for log_file in [ $log_code_server $log_code_app ] {
            if ($log_file | path exists) {
                let content = (open $log_file | default "")
                if ($content | str contains "error") {
                    print $"($env.ALGA_COLOR_RED)Errors in ($log_file):($env.ALGA_COLOR_RESET)"
                    print $content
                }
            }
        }
    }

    # Display the URLs (password aligns with helm/values-hosted-env.yaml default)
    print $"($env.ALGA_COLOR_CYAN)Port forwarding setup:($env.ALGA_COLOR_RESET)"
    print $"  Code Server:        http://localhost:($code_server_port)"
    print $"    Password: alga-dev"
    print $"  PSA App \(in code\):  http://localhost:($code_app_port)"

    # Wait for user to stop
    input "Press Enter to stop port forwarding..."

    # Kill all kubectl port-forward processes for this env
    bash -c $"pkill -f 'kubectl port-forward.*($pf_name)-code-server'" | complete | ignore

    # Clean up logs
    rm -f $log_code_server
    rm -f $log_code_app

    print $"($env.ALGA_COLOR_CYAN)Port forwarding stopped.($env.ALGA_COLOR_RESET)"
}

# Destroy hosted environment
export def hosted-env-destroy [
    branch: string
    --force = false
] {
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"alga-hosted-($sanitized_branch)"
    let role_name = $"alga-psa-hosted-($namespace)"
    let release = $"alga-hosted-($sanitized_branch)"

    if (not $force) {
        print $"($env.ALGA_COLOR_YELLOW)This will permanently destroy the hosted environment for ($branch).($env.ALGA_COLOR_RESET)"
        let confirm = (input "Type 'delete' to confirm: ")
        if $confirm != "delete" { print "Aborted."; return }
    }

    # Attempt to delete per-namespace Vault role (best-effort)
    do {
        let has_vault = (not (which vault | is-empty))
        if $has_vault {
            let del_role = (vault delete auth/kubernetes/role/$role_name | complete)
            if $del_role.exit_code == 0 {
                print $"($env.ALGA_COLOR_CYAN)Deleted Vault role: ($role_name)($env.ALGA_COLOR_RESET)"
                return
            }
        }
        # Fallback: in-cluster delete via Job in msp
        let suffix = ($role_name | hash sha256 | str substring 0..8)
        let job_name = $"vault-role-delete-($suffix)"
        let job_yaml = $"
apiVersion: batch/v1
kind: Job
metadata:
  name: ($job_name)
  namespace: msp
spec:
  ttlSecondsAfterFinished: 60
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: \"false\"
        traffic.sidecar.istio.io/excludeOutboundPorts: \"8200\"
    spec:
      restartPolicy: Never
      containers:
      - name: delete
        image: hashicorp/vault:1.19.0
        command: [\"/bin/sh\",\"-lc\"]
        args:
          - |
            set -euo pipefail
            echo \"Deleting Vault role $ROLE at $VAULT_ADDR\"
            vault delete auth/kubernetes/role/$ROLE
        env:
        - name: ROLE
          value: ($role_name)
        - name: VAULT_ADDR
          value: http://vault.vault.svc:8200
        - name: VAULT_TOKEN
          valueFrom:
            secretKeyRef:
              name: vault-credentials
              key: VAULT_TOKEN
"
        (echo $job_yaml | kubectl apply -f - | complete) | ignore
        (kubectl -n msp wait --for=condition=complete --timeout=120s job/$job_name | complete) | ignore
        (kubectl -n msp delete job $job_name --ignore-not-found=true | complete) | ignore
    }

    # If namespace already gone, skip uninstall and deletion
    let ns_check = (kubectl get namespace $namespace | complete)
    if $ns_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_YELLOW)Namespace ($namespace) not found; assuming already deleted.($env.ALGA_COLOR_RESET)"
        return
    }

    # If release exists, uninstall quickly without hooks and a short timeout
    print $"($env.ALGA_COLOR_CYAN)Uninstalling Helm release \(fast\)...($env.ALGA_COLOR_RESET)"
    let rel_check = (helm status $release -n $namespace | complete)
    if $rel_check.exit_code == 0 {
        let helm_un = (helm uninstall $release -n $namespace --no-hooks --timeout 20s | complete)
        if $helm_un.exit_code != 0 {
            print $"($env.ALGA_COLOR_YELLOW)Helm uninstall warning: ($helm_un.stderr | str trim)($env.ALGA_COLOR_RESET)"
        }
    } else {
        print $"($env.ALGA_COLOR_YELLOW)Helm release not found; skipping uninstall.($env.ALGA_COLOR_RESET)"
    }

    # Delete namespace without waiting
    print $"($env.ALGA_COLOR_CYAN)Deleting namespace ($namespace) \(non-blocking\)...($env.ALGA_COLOR_RESET)"
    let del_ns = (kubectl delete namespace $namespace --ignore-not-found=true --wait=false --timeout=15s | complete)
    if $del_ns.exit_code != 0 {
        print $"($env.ALGA_COLOR_YELLOW)Namespace delete issued with warnings: ($del_ns.stderr | str trim)($env.ALGA_COLOR_RESET)"
    }
    print $"($env.ALGA_COLOR_GREEN)Delete initiated. Namespace will terminate in background.($env.ALGA_COLOR_RESET)"
}

# Simple status
export def hosted-env-status [
    branch: string
] {
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"alga-hosted-($sanitized_branch)"
    print $"($env.ALGA_COLOR_CYAN)Status for ($namespace):($env.ALGA_COLOR_RESET)"
    kubectl get all -n $namespace
}
