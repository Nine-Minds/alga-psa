use "config.nu" *
use "utils.nu" *

# Helper to load environment variables from .env.local if it exists
def load-local-env [] {
    let project_root = find-project-root
    let env_file = $"($project_root)/.env.local"

    if ($env_file | path exists) {
        # Parse .env.local file and load variables
        let env_vars = (open $env_file
            | lines
            | where ($it | str trim | str length) > 0
            | where not ($it | str starts-with "#")
            | parse "{key}={value}"
            | transpose -r -d)

        # Load the environment variables
        load-env $env_vars
    }
}

# Determine environment-specific configuration for hosted environments
def get-hosted-env-config [environment?: string] {
    let requested = (if ($environment | is-empty) { "hosted" } else { $environment | str downcase })
    let env_key = if $requested in ["hosted", "dev", "default"] {
        "hosted"
    } else if $requested in ["sebastian", "staging", "hv-dev2"] {
        "sebastian"
    } else {
        error make { msg: $"($env.ALGA_COLOR_RED)Unsupported environment '($environment)'. Use 'hosted' or 'sebastian'.($env.ALGA_COLOR_RESET)" }
    }

    if $env_key == "sebastian" {
        {
            key: "sebastian"
            display: "Sebastian (hv-dev2 cluster)"
            namespace_prefix: "alga-hosted-"
            release_prefix: "alga-hosted-"
            temp_prefix: "hosted-sebastian"
            vault_role_prefix: "alga-psa-hosted-"
            expected_context: "config-hv-dev2"
            kubeconfig_hint: $"($nu.home-path)/.kube/config-hv-dev2"
            values_relative_path: "hosted-env-sebastian/values-hosted-env.yaml"
            vault_enabled: false
        }
    } else {
        {
            key: "hosted"
            display: "Hosted (config cluster)"
            namespace_prefix: "alga-hosted-"
            release_prefix: "alga-hosted-"
            temp_prefix: "hosted"
            vault_role_prefix: "alga-psa-hosted-"
            expected_context: "config"
            kubeconfig_hint: $"($nu.home-path)/.kube/config"
            values_relative_path: "hosted-env-dev/values-hosted-env.yaml"
            vault_enabled: true
        }
    }
}

# Ensure kubectl is pointing at the expected context for the selected environment
def ensure-hosted-env-context [env_cfg: record] {
    let expected = ($env_cfg | get expected_context?)
    if ($expected | is-empty) {
        return
    }

    let kubeconfig_hint = ($env_cfg | get kubeconfig_hint? | default "")
    let set_kubeconfig = {|path|
        if ($path | is-empty) {
            false
        } else if not ($path | path exists) {
            print $"($env.ALGA_COLOR_YELLOW)Expected kubeconfig not found at ($path).($env.ALGA_COLOR_RESET)"
            false
        } else {
            let current_env = ($env.KUBECONFIG? | default "")
            if $current_env != $path {
                print $"($env.ALGA_COLOR_CYAN)Setting KUBECONFIG to ($path) for hosted environment operations.($env.ALGA_COLOR_RESET)"
                load-env { KUBECONFIG: $path }
            }
            true
        }
    }

    mut ctx_result = (kubectl config current-context | complete)
    mut current = if $ctx_result.exit_code == 0 { $ctx_result.stdout | str trim } else { "" }

    if $ctx_result.exit_code != 0 or ($current | is-empty) {
        if not (do $set_kubeconfig $kubeconfig_hint) {
            print $"($env.ALGA_COLOR_RED)Unable to determine kubectl context.($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_YELLOW)Set KUBECONFIG to point at ($kubeconfig_hint) and ensure context ($expected) exists.($env.ALGA_COLOR_RESET)"
            error make { msg: $"($env.ALGA_COLOR_RED)kubectl context check failed($env.ALGA_COLOR_RESET)" }
        }
        $ctx_result = (kubectl config current-context | complete)
        if $ctx_result.exit_code == 0 {
            $current = ($ctx_result.stdout | str trim)
        }
    }

    if $current != $expected {
        if not ($kubeconfig_hint | is-empty) and (($env.KUBECONFIG? | default "") != $kubeconfig_hint) {
            if (do $set_kubeconfig $kubeconfig_hint) {
                $ctx_result = (kubectl config current-context | complete)
                if $ctx_result.exit_code == 0 {
                    $current = ($ctx_result.stdout | str trim)
                }
            }
        }

        if $current == $expected { return }

        # Attempt to switch contexts automatically if available.
        let switched = do {
            let contexts = (kubectl config get-contexts -o name | complete)
            if $contexts.exit_code == 0 and ($contexts.stdout | lines | any {|ctx| $ctx == $expected }) {
                let use_res = (kubectl config use-context $expected | complete)
                if $use_res.exit_code == 0 {
                    print $"($env.ALGA_COLOR_CYAN)Switched kubectl context to ($expected).($env.ALGA_COLOR_RESET)"
                    true
                } else {
                    print $"($env.ALGA_COLOR_YELLOW)kubectl config use-context ($expected) failed: ($use_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
                    false
                }
            } else {
                if ($contexts.exit_code != 0) {
                    print $"($env.ALGA_COLOR_YELLOW)kubectl context list unavailable: ($contexts.stderr | str trim)($env.ALGA_COLOR_RESET)"
                } else {
                    print $"($env.ALGA_COLOR_YELLOW)Context ($expected) not found in kubeconfig.($env.ALGA_COLOR_RESET)"
                }
                false
            }
        }

        if $switched {
            let verify = (kubectl config current-context | complete)
            if $verify.exit_code == 0 {
                let verified_ctx = ($verify.stdout | str trim)
                if $verified_ctx == $expected { return }
            }
        }

        print $"($env.ALGA_COLOR_RED)Active kubectl context '($current)' does not match expected '($expected)' for ($env_cfg.display).($env.ALGA_COLOR_RESET)"
        print $"($env.ALGA_COLOR_YELLOW)Run: export KUBECONFIG=($kubeconfig_hint); kubectl config use-context ($expected)($env.ALGA_COLOR_RESET)"
        error make { msg: $"($env.ALGA_COLOR_RED)Incorrect kubectl context for hosted environment($env.ALGA_COLOR_RESET)" }
    }
}

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

# Trim a Kubernetes DNS label to 63 characters and drop trailing hyphens.
def trim-dns-name [value: string] {
    let initial = if ($value | str length) > 63 { $value | str substring 0..63 } else { $value }
    $initial | str replace -r "-+$" ""
}

# Ensure the Istio VirtualService for Sebastian routes the provided canary header to the hosted env.
def update-hosted-env-canary-route [
    env_cfg: record
    namespace: string
    release: string
    canary: string
] {
    let env_key = ($env_cfg.key? | default "")
    let trimmed_canary = (if $canary == null { "" } else { $canary | str trim })
    if $env_key != "sebastian" {
        return
    }
    if $trimmed_canary == "" {
        print $"($env.ALGA_COLOR_YELLOW)Skipping VirtualService update: --canary value missing.($env.ALGA_COLOR_RESET)"
        return
    }

    let repo_url = "https://github.com/nine-minds/nm-kube-config"
    let repo_dir = "/tmp/nm-kube-config"

    mut repo_ready = false
    if ($repo_dir | path exists) {
        let git_check = (do { cd $repo_dir; git rev-parse --is-inside-work-tree | complete })
        if $git_check.exit_code != 0 {
            print $"($env.ALGA_COLOR_YELLOW)Existing nm-kube-config path at ($repo_dir) is not a git repository; re-cloning...($env.ALGA_COLOR_RESET)"
            (rm -rf $repo_dir | complete) | ignore
        } else {
            print $"($env.ALGA_COLOR_CYAN)Updating existing nm-kube-config checkout...($env.ALGA_COLOR_RESET)"
            let fetch_res = (do { cd $repo_dir; git fetch --prune origin | complete })
            if $fetch_res.exit_code != 0 {
                print $"($env.ALGA_COLOR_YELLOW)git fetch failed: ($fetch_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
            } else {
                let reset_res = (do { cd $repo_dir; git reset --hard origin/main | complete })
                if $reset_res.exit_code != 0 {
                    print $"($env.ALGA_COLOR_YELLOW)git reset failed: ($reset_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
                } else {
                    $repo_ready = true
                }
            }
        }
    }

    if not $repo_ready {
        print $"($env.ALGA_COLOR_CYAN)Cloning nm-kube-config repository to ($repo_dir)...($env.ALGA_COLOR_RESET)"
        let clone_res = (git clone $repo_url $repo_dir | complete)
        if $clone_res.exit_code != 0 {
            print $"($env.ALGA_COLOR_RED)Failed to clone nm-kube-config: ($clone_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
            return
        }
        $repo_ready = true
    }

    if not $repo_ready {
        print $"($env.ALGA_COLOR_YELLOW)nm-kube-config repository unavailable; skipping VirtualService update.($env.ALGA_COLOR_RESET)"
        return
    }

    let base_fullname = (trim-dns-name $"($release)-sebastian")
    let service_name = (trim-dns-name $"($base_fullname)-code-server")
    let destination_host = $"($service_name).($namespace).svc.cluster.local"
    let desired_port = 3000

    let candidate_rel_paths = [
        "alga-psa/istio-gateway-sebastian.yaml"
        "argo-workflow/alga-psa-dev/templates/composite/alga-psa-build-migrate-deploy.yaml"
    ]

    mut target_rel = null
    mut updated_vs = null

    for rel_path in $candidate_rel_paths {
        let file_path = $"($repo_dir)/($rel_path)"
        if not ($file_path | path exists) {
            continue
        }

        let docs_raw = (open --raw $file_path | from yaml)
        let docs_list = if (($docs_raw | describe) | str starts-with "list<") { $docs_raw } else { [ $docs_raw ] }

        mut updated_docs = []
        mut changed = false

        for doc in $docs_list {
            mut doc_mut = $doc
            if (($doc_mut.kind? | default "") == "VirtualService" and ($doc_mut.metadata.name? | default "") == "alga-psa-vs-sebastian") {
                let http_raw = ($doc_mut.spec.http? | default [])
                let http_routes = if (($http_raw | describe) | str starts-with "list<") { $http_raw } else if ($http_raw | is-empty) { [] } else { [ $http_raw ] }
                let route_candidates = (
                    $http_routes
                    | enumerate
                    | where {|row|
                        let route_entry = $row.item
                        let match_raw = ($route_entry.match? | default [])
                        let match_list = if (($match_raw | describe) | str starts-with "list<") { $match_raw } else if ($match_raw | is-empty) { [] } else { [ $match_raw ] }
                        $match_list | any {|m|
                            let headers_rec = ($m.headers? | default {})
                            if (($headers_rec | describe) | str contains "record<") {
                                let candidate = ($headers_rec | get "x-canary"? )
                                if $candidate == null {
                                    ($headers_rec | get "X-Canary"?) != null
                                } else {
                                    true
                                }
                            } else {
                                false
                            }
                        }
                    }
                )
                let route_match = ($route_candidates | get 0? | default null)
                let route_idx = if $route_match == null { null } else { $route_match.index }

                mut http_updated = $http_routes
                if $route_idx == null {
                    let new_route = {
                        name: $"canary-($trimmed_canary)"
                        match: [ { headers: { x-canary: { exact: $trimmed_canary } } } ]
                        route: [
                            {
                                destination: {
                                    host: $destination_host
                                    port: { number: $desired_port }
                                }
                            }
                        ]
                    }
                    $http_updated = [ $new_route ] ++ $http_routes
                } else {
                    let current_route = $route_match.item
                    let routes_raw = ($current_route.route? | default [])
                    let routes_list = if (($routes_raw | describe) | str starts-with "list<") { $routes_raw } else if ($routes_raw | is-empty) { [] } else { [ $routes_raw ] }
                    mut new_routes = $routes_list
                    if ($new_routes | is-empty) {
                        $new_routes = [ { destination: { host: $destination_host, port: { number: $desired_port } } } ]
                    } else {
                        let first_route = ($new_routes | first)
                        let dest_raw = ($first_route.destination? | default {})
                        let dest_port = (($dest_raw.port? | default {}) | upsert number $desired_port)
                        let dest_updated = ($dest_raw | upsert host $destination_host | upsert port $dest_port)
                        let first_updated = ($first_route | upsert destination $dest_updated)
                        $new_routes = [ $first_updated ] ++ ($new_routes | skip 1)
                    }
                    let updated_route = (
                        $current_route
                        | upsert name $"canary-($trimmed_canary)"
                        | upsert match [ { headers: { x-canary: { exact: $trimmed_canary } } } ]
                        | upsert route $new_routes
                    )
                    $http_updated = ($http_routes | update $route_idx $updated_route)
                }

                $doc_mut = ($doc_mut | upsert spec (
                    ($doc_mut.spec? | default {}) | upsert http $http_updated
                ))
                $updated_vs = $doc_mut
                $changed = true
            }
            $updated_docs = $updated_docs ++ [ $doc_mut ]
        }

        if $changed {
            let doc_strings = ($updated_docs | each {|d| $d | to yaml })
            let joined = ($doc_strings | str join "\n---\n")
            let final_content = if ($joined | str ends-with "\n") { $joined } else { $"($joined)\n" }
            $final_content | save --force --raw $file_path
            $target_rel = $rel_path
            break
        }
    }

    if $target_rel == null or $updated_vs == null {
        print $"($env.ALGA_COLOR_YELLOW)VirtualService alga-psa-vs-sebastian not found in nm-kube-config; skipping update.($env.ALGA_COLOR_RESET)"
        return
    }

    let temp_vs_path = $"($repo_dir)/.tmp-alga-psa-vs-sebastian.yaml"
    ($updated_vs | to yaml) | save --force --raw $temp_vs_path
    let apply_res = (kubectl apply -f $temp_vs_path | complete)
    if $apply_res.exit_code == 0 {
        print $"($env.ALGA_COLOR_GREEN)Updated x-canary route '($trimmed_canary)' → ($destination_host):($desired_port).($env.ALGA_COLOR_RESET)"
    } else {
        print $"($env.ALGA_COLOR_YELLOW)kubectl apply for VirtualService failed: ($apply_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
    }
    (rm -f $temp_vs_path | complete) | ignore

    let status_res = (do { cd $repo_dir; git status --porcelain | complete })
    if $status_res.exit_code != 0 {
        print $"($env.ALGA_COLOR_YELLOW)Unable to determine nm-kube-config git status: ($status_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
        return
    }
    if ($status_res.stdout | str trim | is-empty) {
        return
    }

    let target_rel_path = $target_rel
    let add_res = (do { cd $repo_dir; git add $target_rel_path | complete })
    if $add_res.exit_code != 0 {
        print $"($env.ALGA_COLOR_YELLOW)git add failed for nm-kube-config: ($add_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
        return
    }

    let commit_message = $"Update canary ($trimmed_canary) VirtualService target"
    let commit_res = (do { cd $repo_dir; git commit -m $commit_message | complete })
    if $commit_res.exit_code != 0 {
        print $"($env.ALGA_COLOR_YELLOW)git commit failed for nm-kube-config: ($commit_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
        return
    }

    let push_res = (do { cd $repo_dir; git push origin HEAD | complete })
    if $push_res.exit_code != 0 {
        print $"($env.ALGA_COLOR_YELLOW)git push failed for nm-kube-config: ($push_res.stderr | str trim)($env.ALGA_COLOR_RESET)"
        return
    }

    print $"($env.ALGA_COLOR_GREEN)Pushed VirtualService update to nm-kube-config for canary '($trimmed_canary)'.($env.ALGA_COLOR_RESET)"
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
    --environment (-e): string = "hosted"
] {
    # Load local environment variables if available
    load-local-env
    let env_cfg = (get-hosted-env-config $environment)
    ensure-hosted-env-context $env_cfg

    let project_root = find-project-root
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"($env_cfg.namespace_prefix)($sanitized_branch)"
    let release = $"($env_cfg.release_prefix)($sanitized_branch)"

    print $"($env.ALGA_COLOR_CYAN)Creating hosted environment for branch: ($branch) → ($namespace) on ($env_cfg.display)($env.ALGA_COLOR_RESET)"

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
    let temp_values_file = $"($project_root)/temp-values-($env_cfg.temp_prefix)-($safe_filename).yaml"
    let role_name = $"($env_cfg.vault_role_prefix)($namespace)"

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

    if ($env_cfg.vault_enabled? | default true) {
        ensure-vault-role $role_name $namespace
    } else {
        print $"($env.ALGA_COLOR_YELLOW)Vault role creation skipped for ($env_cfg.display).($env.ALGA_COLOR_RESET)"
    }

    # Copy required secrets from msp namespace
    print $"($env.ALGA_COLOR_CYAN)Copying required secrets to ($namespace)...($env.ALGA_COLOR_RESET)"

    # Copy nm-store-db-secret if it exists in msp namespace
    let nm_store_secret_exists = (kubectl -n msp get secret nm-store-db-secret | complete)
    if $nm_store_secret_exists.exit_code == 0 {
        # Delete existing secret first to avoid conflicts
        (kubectl delete secret nm-store-db-secret -n $namespace --ignore-not-found=true | complete) | ignore
        (kubectl -n msp get secret nm-store-db-secret -o yaml |
         sed $"s/namespace: msp/namespace: ($namespace)/" |
         kubectl apply -f - | complete) | ignore
        print $"($env.ALGA_COLOR_GREEN)✓ Copied nm-store-db-secret($env.ALGA_COLOR_RESET)"
    } else {
        print $"($env.ALGA_COLOR_YELLOW)⚠ nm-store-db-secret not found in msp namespace($env.ALGA_COLOR_RESET)"
    }

    # Copy resend-credentials if it exists in msp namespace
    let resend_secret_exists = (kubectl -n msp get secret resend-credentials | complete)
    if $resend_secret_exists.exit_code == 0 {
        # Delete existing secret first to avoid conflicts
        (kubectl delete secret resend-credentials -n $namespace --ignore-not-found=true | complete) | ignore
        (kubectl -n msp get secret resend-credentials -o yaml |
         sed $"s/namespace: msp/namespace: ($namespace)/" |
         kubectl apply -f - | complete) | ignore
        print $"($env.ALGA_COLOR_GREEN)✓ Copied resend-credentials($env.ALGA_COLOR_RESET)"
    } else {
        print $"($env.ALGA_COLOR_YELLOW)⚠ resend-credentials not found in msp namespace($env.ALGA_COLOR_RESET)"
    }

    # Copy temporal-worker-secret if it exists in msp namespace
    let temporal_secret_exists = (kubectl -n msp get secret temporal-worker-secret | complete)
    if $temporal_secret_exists.exit_code == 0 {
        # Delete existing secret first to avoid conflicts
        (kubectl delete secret temporal-worker-secret -n $namespace --ignore-not-found=true | complete) | ignore
        (kubectl -n msp get secret temporal-worker-secret -o yaml |
         sed $"s/namespace: msp/namespace: ($namespace)/" |
         kubectl apply -f - | complete) | ignore
        print $"($env.ALGA_COLOR_GREEN)✓ Copied temporal-worker-secret($env.ALGA_COLOR_RESET)"
    } else {
        print $"($env.ALGA_COLOR_YELLOW)⚠ temporal-worker-secret not found in msp namespace($env.ALGA_COLOR_RESET)"
    }

    # Copy redis-credentials if it exists in msp namespace
    let redis_secret_exists = (kubectl -n msp get secret redis-credentials | complete)
    if $redis_secret_exists.exit_code == 0 {
        # Delete existing secret first to avoid conflicts
        (kubectl delete secret redis-credentials -n $namespace --ignore-not-found=true | complete) | ignore
        (kubectl -n msp get secret redis-credentials -o yaml |
         sed $"s/namespace: msp/namespace: ($namespace)/" |
         kubectl apply -f - | complete) | ignore
        print $"($env.ALGA_COLOR_GREEN)✓ Copied redis-credentials($env.ALGA_COLOR_RESET)"
    } else {
        print $"($env.ALGA_COLOR_YELLOW)⚠ redis-credentials not found in msp namespace($env.ALGA_COLOR_RESET)"
    }

    # Copy harbor-credentials if it exists in msp namespace
    let harbor_secret_exists = (kubectl -n msp get secret harbor-credentials | complete)
    if $harbor_secret_exists.exit_code == 0 {
        # Delete existing secret first to avoid conflicts
        (kubectl delete secret harbor-credentials -n $namespace --ignore-not-found=true | complete) | ignore
        (kubectl -n msp get secret harbor-credentials -o yaml |
         sed $"s/namespace: msp/namespace: ($namespace)/" |
         kubectl apply -f - | complete) | ignore
        print $"($env.ALGA_COLOR_GREEN)✓ Copied harbor-credentials($env.ALGA_COLOR_RESET)"
    } else {
        print $"($env.ALGA_COLOR_YELLOW)⚠ harbor-credentials not found in msp namespace($env.ALGA_COLOR_RESET)"
    }

    # Copy minio-credentials if it exists in msp namespace
    let minio_secret_exists = (kubectl -n msp get secret minio-credentials | complete)
    if $minio_secret_exists.exit_code == 0 {
        # Delete existing secret first to avoid conflicts
        (kubectl delete secret minio-credentials -n $namespace --ignore-not-found=true | complete) | ignore
        (kubectl -n msp get secret minio-credentials -o yaml |
         sed $"s/namespace: msp/namespace: ($namespace)/" |
         kubectl apply -f - | complete) | ignore
        print $"($env.ALGA_COLOR_GREEN)✓ Copied minio-credentials($env.ALGA_COLOR_RESET)"
    } else {
        print $"($env.ALGA_COLOR_YELLOW)⚠ minio-credentials not found in msp namespace($env.ALGA_COLOR_RESET)"
    }

    # Create a simple override values file with dynamic branch information
    let vault_role = $"($env_cfg.vault_role_prefix)($namespace)"
    let branch_overrides = $"
# Branch-specific overrides for hosted environment
hostedEnv:
  enabled: true
  branch: \"($branch)\"
  sanitizedBranch: \"($sanitized_branch)\"
  namespace: \"($namespace)\"
  repository:
    branch: \"($branch)\"
vaultAgent:
  role: \"($vault_role)\"
"

    $branch_overrides | save -f $temp_values_file

    try {
        print $"($env.ALGA_COLOR_CYAN)Deploying Helm chart...($env.ALGA_COLOR_RESET)"
        # Use ALGA_KUBE_CONFIG_PATH env var if set, otherwise use default relative to home
        let kube_config_base = if ($env.ALGA_KUBE_CONFIG_PATH? | is-empty) {
            $"($nu.home-path)/nm-kube-config"
        } else {
            $env.ALGA_KUBE_CONFIG_PATH
        }
        let user_values_path = $"($kube_config_base)/($env_cfg.values_relative_path)"
        let user_values_exists = ($user_values_path | path exists)
        if not $user_values_exists {
            print $"($env.ALGA_COLOR_YELLOW)Warning: ($user_values_path) not found. Proceeding with generated values only.($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_YELLOW)Tip: Set ALGA_KUBE_CONFIG_PATH to your nm-kube-config directory or create the file if overrides are needed.($env.ALGA_COLOR_RESET)"
        }
        if not $user_values_exists {
            error make { msg: $"($env.ALGA_COLOR_RED)Required values file not found: ($user_values_path)($env.ALGA_COLOR_RESET)" }
        }

        let helm_cmd = $"helm upgrade --install ($release) ./helm -f ($user_values_path) -f ($temp_values_file) -n ($namespace)"
        let helm_result = do {
            cd $project_root
            bash -c $helm_cmd | complete
        }

        if $helm_result.exit_code != 0 {
            let stderr_l = ($helm_result.stderr | str downcase)
            let ns_exists = ($stderr_l | str contains 'already exists')
            let benign_warn = ($stderr_l | str contains 'warning:')
            if $ns_exists or $benign_warn {
                print $"($env.ALGA_COLOR_YELLOW)Helm reported non-fatal issues; retrying with --install...($env.ALGA_COLOR_RESET)"
                let retry_install = do {
                    cd $project_root
                    # Re-evaluate in case ALGA_KUBE_CONFIG_PATH changed between attempts
                    let kube_config_base = if ($env.ALGA_KUBE_CONFIG_PATH? | is-empty) {
                        $"($nu.home-path)/nm-kube-config"
                    } else {
                        $env.ALGA_KUBE_CONFIG_PATH
                    }
                    let retry_user_values = $"($kube_config_base)/($env_cfg.values_relative_path)"
                    let retry_exists = ($retry_user_values | path exists)
                    if not $retry_exists {
                        error make { msg: $"($env.ALGA_COLOR_RED)Required values file not found during retry: ($retry_user_values)($env.ALGA_COLOR_RESET)" }
                    }

                    let retry_cmd = $"helm upgrade --install ($release) ./helm -f ($retry_user_values) -f ($temp_values_file) -n ($namespace)"
                    bash -c $retry_cmd | complete
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
        let wait_result = (kubectl wait --for=condition=available --timeout=300s deployment -l app.kubernetes.io/instance=$release -n $namespace | complete)
        if $wait_result.exit_code == 0 {
            print $"($env.ALGA_COLOR_GREEN)Hosted environment ready.($env.ALGA_COLOR_RESET)"
        } else {
            print $"($env.ALGA_COLOR_YELLOW)Some deployments may still be starting.($env.ALGA_COLOR_RESET)"
        }

        print $"Run: hosted-env-connect ($branch) --canary ($sanitized_branch)  # to port-forward code-server"
        print $"Run: hosted-env-status  ($branch)  # to view status"
    } catch { |err|
        print $"($env.ALGA_COLOR_RED)Error: ($err)($env.ALGA_COLOR_RESET)"
    }

    if ($temp_values_file | path exists) { rm $temp_values_file }
}

# List hosted environments
export def hosted-env-list [
    --environment (-e): string = "hosted"
] {
    let env_cfg = (get-hosted-env-config $environment)
    ensure-hosted-env-context $env_cfg
    print $"($env.ALGA_COLOR_CYAN)Active hosted environments on ($env_cfg.display):($env.ALGA_COLOR_RESET)"
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
        let branch = ($parts | get column2? | get 0? | default "Unknown")
        print $"│ ($namespace | fill -w 28) │ ($branch | fill -w 24) │"
    }
    print "└────────────────────────────────────────────────────────────┘"
}

# Connect (port-forward) to code-server in hosted environment
export def hosted-env-connect [
    branch: string
    --environment (-e): string = "hosted"
    --canary (-c): string
] {
    let env_cfg = (get-hosted-env-config $environment)
    ensure-hosted-env-context $env_cfg
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"($env_cfg.namespace_prefix)($sanitized_branch)"
    let release = $"($env_cfg.release_prefix)($sanitized_branch)"
    let canary_value = if $canary == null { "" } else { $canary | str trim }
    if $canary_value == "" {
        error make { msg: $"($env.ALGA_COLOR_RED)hosted-env-connect now requires '--canary <header_value>' to update the Istio route.($env.ALGA_COLOR_RESET)" }
    }

    # Ensure environment exists
    let env_check = (kubectl get namespace $namespace | complete)
    if $env_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Environment for branch ($branch) not found.($env.ALGA_COLOR_RESET)"
        print $"($env.ALGA_COLOR_YELLOW)Use 'hosted-env-list' to see available environments.($env.ALGA_COLOR_RESET)"
        return
    }

    print $"($env.ALGA_COLOR_CYAN)Connecting to hosted environment for branch: ($branch) on ($env_cfg.display)($env.ALGA_COLOR_RESET)"
    update-hosted-env-canary-route $env_cfg $namespace $release $canary_value
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
    # Find the code-server pod for direct forwarding (more reliable than service forwarding with Istio)
    let pod_result = (kubectl get pods -n $namespace -l app.kubernetes.io/component=code-server -o jsonpath='{.items[0].metadata.name}' | complete)
    if $pod_result.exit_code != 0 or ($pod_result.stdout | str trim | is-empty) {
        print $"($env.ALGA_COLOR_RED)Could not find code-server pod in namespace ($namespace)($env.ALGA_COLOR_RESET)"
        return
    }
    let pod_name = ($pod_result.stdout | str trim)
    let log_code_server = $"/tmp/pf-($env_cfg.temp_prefix)-code-server-($sanitized_branch).log"
    let log_code_app    = $"/tmp/pf-($env_cfg.temp_prefix)-code-app-($sanitized_branch).log"

    bash -c $"kubectl port-forward -n ($namespace) pod/($pod_name) --address=127.0.0.1 ($code_server_port):8080 > ($log_code_server) 2>&1 &"
    bash -c $"kubectl port-forward -n ($namespace) pod/($pod_name) --address=127.0.0.1 ($code_app_port):3000 > ($log_code_app) 2>&1 &"

    # Give processes time to start
    sleep 2sec

    # Verify background processes started
    let pf_check = do { bash -c $"ps aux | grep -E 'kubectl port-forward.*pod/($pod_name)' | grep -v grep | wc -l" | complete }
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
    print $"    Password: alga-dev  \(default from helm/values-hosted-env.yaml\)"
    print $"  PSA App \(in code\):  http://localhost:($code_app_port)"

    # Wait for user to stop
    input "Press Enter to stop port forwarding..."

    # Kill all kubectl port-forward processes for this env
    bash -c $"pkill -f 'kubectl port-forward.*pod/($pod_name)'" | complete | ignore

    # Clean up logs
    rm -f $log_code_server
    rm -f $log_code_app

    print $"($env.ALGA_COLOR_CYAN)Port forwarding stopped.($env.ALGA_COLOR_RESET)"
}

# Destroy hosted environment
export def hosted-env-destroy [
    branch: string
    --force = false
    --environment (-e): string = "hosted"
] {
    let env_cfg = (get-hosted-env-config $environment)
    ensure-hosted-env-context $env_cfg
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"($env_cfg.namespace_prefix)($sanitized_branch)"
    let role_name = $"($env_cfg.vault_role_prefix)($namespace)"
    let release = $"($env_cfg.release_prefix)($sanitized_branch)"

    if (not $force) {
        print $"($env.ALGA_COLOR_YELLOW)This will permanently destroy the hosted environment for ($branch) on ($env_cfg.display).($env.ALGA_COLOR_RESET)"
        let confirm = (input "Type 'delete' to confirm: ")
        if $confirm != "delete" { print "Aborted."; return }
    }

    # Attempt to delete per-namespace Vault role (best-effort)
    if ($env_cfg.vault_enabled? | default true) {
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
    } else {
        print $"($env.ALGA_COLOR_YELLOW)Vault role deletion skipped for ($env_cfg.display).($env.ALGA_COLOR_RESET)"
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
    --environment (-e): string = "hosted"
] {
    let env_cfg = (get-hosted-env-config $environment)
    ensure-hosted-env-context $env_cfg
    let sanitized_branch = (sanitize-branch-name $branch)
    let namespace = $"($env_cfg.namespace_prefix)($sanitized_branch)"
    print $"($env.ALGA_COLOR_CYAN)Status for ($namespace) on ($env_cfg.display):($env.ALGA_COLOR_RESET)"
    kubectl get all -n $namespace
}
