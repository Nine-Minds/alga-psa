#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"

require_file() {
  [ -f "$1" ] || { echo "missing file: $1" >&2; exit 1; }
}

require_dir() {
  [ -d "$1" ] || { echo "missing directory: $1" >&2; exit 1; }
}

require_text() {
  local haystack="$1"
  local needle="$2"
  printf '%s\n' "$haystack" | grep -Fq -- "$needle" || {
    echo "expected output to contain: $needle" >&2
    exit 1
  }
}

require_not_text() {
  local haystack="$1"
  local needle="$2"
  if printf '%s\n' "$haystack" | grep -Fq -- "$needle"; then
    echo "expected output to not contain: $needle" >&2
    exit 1
  fi
}

require_dir "$ROOT/ee/appliance"
require_dir "$ROOT/ee/appliance/flux"
require_dir "$ROOT/ee/appliance/manifests"
require_dir "$ROOT/ee/appliance/releases"
require_dir "$ROOT/ee/appliance/schematics"
require_dir "$ROOT/ee/appliance/scripts"
require_dir "$ROOT/ee/appliance/tests"

require_file "$ROOT/ee/appliance/README.md"
require_file "$ROOT/ee/appliance/manifests/local-path-storage.yaml"
require_file "$ROOT/ee/appliance/flux/base/platform/appliance-status.yaml"
require_file "$ROOT/ee/appliance/flux/base/flux/kustomizations.yaml"
require_file "$ROOT/ee/appliance/flux/base/platform/kustomization.yaml"
require_file "$ROOT/ee/appliance/flux/base/core/kustomization.yaml"
require_file "$ROOT/ee/appliance/flux/base/background/kustomization.yaml"
require_file "$ROOT/ee/appliance/schematics/metal-amd64.yaml"
require_file "$ROOT/ee/appliance/releases/schema.json"
require_file "$ROOT/ee/appliance/releases/channels/candidate.json"
require_file "$ROOT/ee/appliance/releases/channels/stable.json"
require_file "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh"
require_file "$ROOT/ee/helm/temporal/templates/deployment.yaml"
require_file "$ROOT/ee/helm/temporal/templates/ui.yaml"
require_file "$ROOT/ee/appliance/scripts/build-images.sh"
require_file "$ROOT/ee/appliance/scripts/collect-support-bundle.sh"
require_file "$ROOT/ee/appliance/scripts/install-storage.sh"
require_file "$ROOT/ee/appliance/scripts/repair-release.sh"
require_file "$ROOT/ee/appliance/scripts/reset-appliance-data.sh"
require_file "$ROOT/ee/appliance/scripts/upgrade-appliance.sh"
require_file "$ROOT/ee/appliance/tests/local-utm-smoke.sh"

bash "$ROOT/ee/appliance/scripts/build-images.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/collect-support-bundle.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/install-storage.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/repair-release.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/reset-appliance-data.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/upgrade-appliance.sh" --help >/dev/null
bash "$ROOT/ee/appliance/tests/local-utm-smoke.sh" --help >/dev/null
bash -n "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh"
bash -n "$ROOT/ee/appliance/scripts/collect-support-bundle.sh"
bash -n "$ROOT/ee/appliance/scripts/install-storage.sh"
bash -n "$ROOT/ee/appliance/scripts/repair-release.sh"
bash -n "$ROOT/ee/appliance/scripts/reset-appliance-data.sh"
bash -n "$ROOT/ee/appliance/scripts/upgrade-appliance.sh"
bash -n "$ROOT/ee/appliance/tests/local-utm-smoke.sh"
bash "$ROOT/ee/appliance/scripts/reset-appliance-data.sh" --kubeconfig /tmp/example.kubeconfig --force --dry-run >/dev/null

dry_run_output="$(
  EE_APPLIANCE_SCHEMATIC_ID_OVERRIDE=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  bash "$ROOT/ee/appliance/scripts/build-images.sh" \
    --release-version 1.0-rc5 \
    --talos-version v1.12.0 \
    --kubernetes-version v1.31.4 \
    --app-version 1.0-rc3 \
    --app-release-branch release/1.0-rc3 \
    --alga-core-tag aaa111 \
    --workflow-worker-tag bbb222 \
    --email-service-tag ccc333 \
    --temporal-worker-tag ddd444 \
    --dry-run
)"

require_text "$dry_run_output" "\"releaseVersion\": \"1.0-rc5\""
require_text "$dry_run_output" "\"schematicId\": \"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\""
require_text "$dry_run_output" "https://factory.talos.dev/image/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/v1.12.0/metal-amd64.iso"
require_text "$dry_run_output" "factory.talos.dev/metal-installer/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:v1.12.0"
require_text "$dry_run_output" "\"valuesProfile\": \"talos-single-node\""
require_text "$dry_run_output" "\"releaseBranch\": \"release/1.0-rc3\""
require_text "$dry_run_output" "\"algaCore\": \"aaa111\""

bootstrap_tmp="$(mktemp -d)"
bootstrap_dry_run_output="$(
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 1.0-rc5 \
    --bootstrap-mode fresh \
    --node-ip 192.0.2.10 \
    --hostname alga-appliance \
    --app-url https://psa.example.test \
    --interface enp0s1 \
    --network-mode dhcp \
    --repo-url https://github.com/example/alga-psa.git \
    --repo-branch main \
    --config-dir "$bootstrap_tmp" \
    --dry-run
)"

require_text "$bootstrap_dry_run_output" "talosctl gen config"
require_text "$bootstrap_dry_run_output" "reset-appliance-data.sh"
require_text "$bootstrap_dry_run_output" "create source git alga-appliance"
require_text "$bootstrap_dry_run_output" "install-storage.sh --kubeconfig"
require_text "$bootstrap_dry_run_output" "collect-support-bundle.sh"
require_text "$bootstrap_dry_run_output" "validate remote background image tags in GHCR"
require_text "$bootstrap_dry_run_output" "write status token to"
require_text "$bootstrap_dry_run_output" "create/apply secret appliance-system/appliance-status-auth"
require_text "$bootstrap_dry_run_output" "Appliance status UI:"
require_text "$bootstrap_dry_run_output" "URL:   http://192.0.2.10:8080"
require_text "$bootstrap_dry_run_output" "Token:"
require_text "$(cat "$ROOT/ee/helm/temporal/templates/deployment.yaml")" 'entrypoint.sh autosetup'
require_text "$(cat "$ROOT/ee/helm/temporal/templates/deployment.yaml")" 'enableServiceLinks: false'
require_text "$(cat "$ROOT/ee/helm/temporal/templates/ui.yaml")" 'enableServiceLinks: false'
require_text "$(cat "$bootstrap_tmp/values/alga-core.talos-single-node.yaml")" 'appUrl: "https://psa.example.test"'
require_text "$(cat "$bootstrap_tmp/values/alga-core.talos-single-node.yaml")" 'host: "psa.example.test"'
require_text "$(cat "$bootstrap_tmp/values/alga-core.talos-single-node.yaml")" 'domainSuffix: ""'
require_text "$(cat "$bootstrap_tmp/values/alga-core.talos-single-node.yaml")" 'tag: "a2cbb430"'
require_text "$(cat "$bootstrap_tmp/values/workflow-worker.talos-single-node.yaml")" 'tag: "61e4a00e"'

current_branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
branch_remote_tmp="$(mktemp -d)"
git init --bare "$branch_remote_tmp/alga-psa.git" >/dev/null 2>&1
git -C "$ROOT" push "$branch_remote_tmp/alga-psa.git" "HEAD:refs/heads/$current_branch" >/dev/null 2>&1
branch_test_tmp="$(mktemp -d)"
branch_test_output="$({
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 1.0-rc5 \
    --bootstrap-mode recover \
    --node-ip 192.0.2.10 \
    --app-url https://psa.example.test \
    --repo-url "$branch_remote_tmp/alga-psa.git" \
    --repo-branch current \
    --kubeconfig /tmp/example.kubeconfig \
    --config-dir "$branch_test_tmp" \
    --dry-run
} 2>&1)"
require_text "$branch_test_output" "Repo branch:     $current_branch"
require_text "$branch_test_output" "Source mode:     branch-under-test"
require_text "$branch_test_output" "Flux source branch differs from release manifest branch"
require_text "$branch_test_output" "local worktree has uncommitted changes"
missing_branch_output="$({
  set +e
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 1.0-rc5 \
    --bootstrap-mode recover \
    --node-ip 192.0.2.10 \
    --app-url https://psa.example.test \
    --repo-url "$branch_remote_tmp/alga-psa.git" \
    --repo-branch does-not-exist \
    --require-remote-branch \
    --kubeconfig /tmp/example.kubeconfig \
    --config-dir "$branch_test_tmp/missing" \
    --dry-run
  echo "exit_code:$?"
} 2>&1)"
require_text "$missing_branch_output" "Flux source branch is not available on the configured remote."
require_text "$missing_branch_output" "exit_code:1"

printf 'stale\n' > "$bootstrap_tmp/kubeconfig"
stale_bootstrap_dry_run_output="$(
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 1.0-rc5 \
    --bootstrap-mode fresh \
    --node-ip 192.0.2.10 \
    --hostname alga-appliance \
    --app-url https://psa.example.test \
    --interface enp0s1 \
    --network-mode dhcp \
    --repo-url https://github.com/example/alga-psa.git \
    --repo-branch main \
    --config-dir "$bootstrap_tmp" \
    --dry-run
)"

require_text "$stale_bootstrap_dry_run_output" "talosctl gen config"
require_text "$stale_bootstrap_dry_run_output" "wait for Talos maintenance API on 192.0.2.10"

explicit_cfg_tmp="$(mktemp -d)"
printf 'apiVersion: v1\nclusters: []\ncontexts: []\nusers: []\n' > "$explicit_cfg_tmp/reuse.kubeconfig"
printf 'context: appliance\n' > "$explicit_cfg_tmp/reuse.talosconfig"
explicit_reuse_output="$(
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 1.0-rc5 \
    --bootstrap-mode recover \
    --repo-url https://github.com/example/alga-psa.git \
    --repo-branch main \
    --kubeconfig "$explicit_cfg_tmp/reuse.kubeconfig" \
    --talosconfig "$explicit_cfg_tmp/reuse.talosconfig" \
    --config-dir "$explicit_cfg_tmp/site" \
    --dry-run
)"
if printf '%s\n' "$explicit_reuse_output" | grep -Fq "talosctl gen config"; then
  echo "expected explicit kubeconfig/talosconfig reuse path to skip talosctl gen config" >&2
  exit 1
fi

# T013: non-dry-run bootstrap with mocked cluster commands writes status-token,
# creates/applies appliance-status-auth Secret, and prints URL/token.
t013_tmp="$(mktemp -d)"
t013_fakebin="$t013_tmp/fakebin"
mkdir -p "$t013_fakebin"
cat >"$t013_fakebin/kubectl" <<'EOF'
#!/usr/bin/env bash
printf 'kubectl %s\n' "$*" >>"${BOOTSTRAP_MOCK_LOG:?}"
if [[ "$*" == *"create secret generic appliance-status-auth"* ]] && [[ "$*" == *"--dry-run=client -o yaml"* ]]; then
  cat <<'YAML'
apiVersion: v1
kind: Secret
metadata:
  name: appliance-status-auth
YAML
fi
exit 0
EOF
cat >"$t013_fakebin/flux" <<'EOF'
#!/usr/bin/env bash
printf 'flux %s\n' "$*" >>"${BOOTSTRAP_MOCK_LOG:?}"
exit 0
EOF
cat >"$t013_fakebin/talosctl" <<'EOF'
#!/usr/bin/env bash
printf 'talosctl %s\n' "$*" >>"${BOOTSTRAP_MOCK_LOG:?}"
exit 0
EOF
cat >"$t013_fakebin/curl" <<'EOF'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >>"${BOOTSTRAP_MOCK_LOG:?}"
if [[ "$*" == *":8080/healthz"* ]]; then
  exit 0
fi
exec /usr/bin/curl "$@"
EOF
chmod +x "$t013_fakebin/kubectl" "$t013_fakebin/flux" "$t013_fakebin/talosctl" "$t013_fakebin/curl"
printf 'apiVersion: v1\nclusters: []\ncontexts: []\nusers: []\n' > "$t013_tmp/reuse.kubeconfig"
printf 'context: appliance\n' > "$t013_tmp/reuse.talosconfig"
export BOOTSTRAP_MOCK_LOG="$t013_tmp/mock.log"
t013_output="$(
  PATH="$t013_fakebin:$PATH" \
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 1.0-rc5 \
    --bootstrap-mode recover \
    --node-ip 192.0.2.77 \
    --repo-url https://github.com/example/alga-psa.git \
    --repo-branch main \
    --kubeconfig "$t013_tmp/reuse.kubeconfig" \
    --talosconfig "$t013_tmp/reuse.talosconfig" \
    --config-dir "$t013_tmp/site" \
    --skip-image-tag-validation
)"
require_file "$t013_tmp/site/status-token"
t013_token_file="$(tr -d '\n' < "$t013_tmp/site/status-token")"
t013_token_printed="$(printf '%s\n' "$t013_output" | sed -n 's/^[[:space:]]*Token: //p' | head -n 1 | tr -d '\n')"
if [ -z "$t013_token_printed" ] || [ "$t013_token_printed" != "$t013_token_file" ]; then
  echo "expected printed status token to match persisted token file" >&2
  exit 1
fi
require_text "$t013_output" "Appliance status UI:"
require_text "$t013_output" "Status token: $t013_tmp/site/status-token"
require_text "$(cat "$t013_tmp/mock.log")" "-n appliance-system create secret generic appliance-status-auth"
require_text "$(cat "$t013_tmp/mock.log")" "kubectl --kubeconfig $t013_tmp/reuse.kubeconfig apply -f -"

# T014: execute embedded appliance-status server and verify token auth behavior.
t014_tmp="$(mktemp -d)"
t014_server="$t014_tmp/server.js"
python3 - "$ROOT/ee/appliance/flux/base/platform/appliance-status.yaml" "$t014_server" <<'PY'
import pathlib
import sys

src = pathlib.Path(sys.argv[1]).read_text()
start = "cat <<'JS' >/tmp/server.js\n"
end = "\n              JS\n"
i = src.find(start)
if i < 0:
    raise SystemExit("could not find embedded JS start marker")
j = src.find(end, i + len(start))
if j < 0:
    raise SystemExit("could not find embedded JS end marker")
body = src[i + len(start):j]
pathlib.Path(sys.argv[2]).write_text(body)
PY
perl -0pi -e "s/server\\.listen\\(8080, '0\\.0\\.0\\.0'\\);/server.listen(Number(process.env.PORT || 18080), '127.0.0.1');/" "$t014_server"
STATUS_TOKEN="integration-token" HOST_IP="192.0.2.77" PORT=18080 node "$t014_server" >"$t014_tmp/server.log" 2>&1 &
t014_pid=$!
cleanup_t014() {
  if kill -0 "$t014_pid" >/dev/null 2>&1; then
    kill "$t014_pid" >/dev/null 2>&1 || true
    wait "$t014_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup_t014 EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:18080/healthz?token=integration-token" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
t014_unauth_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:18080/api/status")"
[ "$t014_unauth_code" = "401" ] || { echo "expected unauthenticated /api/status to return 401, got $t014_unauth_code" >&2; exit 1; }
t014_auth_header="$(curl -fsS -H "Authorization: Bearer integration-token" "http://127.0.0.1:18080/api/status")"
t014_auth_query="$(curl -fsS "http://127.0.0.1:18080/api/status?token=integration-token")"
require_text "$t014_auth_header" '"service":"appliance-status"'
require_text "$t014_auth_header" '"status":"installing"'
require_text "$t014_auth_query" '"loginUrl":"http://192.0.2.77:3000"'
cleanup_t014
trap - EXIT

# T015: RBAC grants read-only resource visibility without secret access or mutation verbs.
t015_rules_file="$ROOT/ee/appliance/flux/base/platform/appliance-status.yaml"
t015_core_resources="$(yq eval 'select(.kind == "ClusterRole") | .rules[] | select(.apiGroups[0] == "") | .resources[]' "$t015_rules_file")"
t015_apps_resources="$(yq eval 'select(.kind == "ClusterRole") | .rules[] | select(.apiGroups[0] == "apps") | .resources[]' "$t015_rules_file")"
t015_all_resources="$(yq eval 'select(.kind == "ClusterRole") | .rules[] | .resources[]' "$t015_rules_file")"
require_text "$t015_core_resources" "nodes"
require_text "$t015_core_resources" "pods"
require_text "$t015_core_resources" "persistentvolumeclaims"
require_text "$t015_apps_resources" "deployments"
require_text "$t015_apps_resources" "statefulsets"
require_text "$t015_core_resources" "events"
require_text "$t015_core_resources" "configmaps"
require_text "$t015_all_resources" "jobs"
require_text "$t015_all_resources" "gitrepositories"
require_text "$t015_all_resources" "kustomizations"
require_text "$t015_all_resources" "helmreleases"
t015_verbs="$(yq eval 'select(.kind == "ClusterRole") | .rules[] | .verbs[]' "$t015_rules_file")"
require_not_text "$t015_verbs" "create"
require_not_text "$t015_verbs" "update"
require_not_text "$t015_verbs" "patch"
require_not_text "$t015_verbs" "delete"
require_not_text "$t015_all_resources" "secrets"

# T018: release validation reports missing background image tags without blocking core bootstrap.
t018_tmp="$(mktemp -d)"
t018_fakebin="$t018_tmp/fakebin"
mkdir -p "$t018_fakebin"
cat >"$t018_fakebin/kubectl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$t018_fakebin/flux" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$t018_fakebin/talosctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$t018_fakebin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *":8080/healthz"* ]]; then
  exit 0
fi
if [[ "$*" == *"ghcr.io/token?scope=repository:nine-minds/workflow-worker:pull"* ]]; then
  printf '{"token":"mock-token"}\n'
  exit 0
fi
if [[ "$*" == *"ghcr.io/token?scope=repository:nine-minds/temporal-worker:pull"* ]]; then
  printf '{"token":"mock-token"}\n'
  exit 0
fi
if [[ "$*" == *"ghcr.io/v2/nine-minds/workflow-worker/manifests/"* ]]; then
  exit 22
fi
if [[ "$*" == *"ghcr.io/v2/nine-minds/temporal-worker/manifests/"* ]]; then
  exit 22
fi
exec /usr/bin/curl "$@"
EOF
chmod +x "$t018_fakebin/kubectl" "$t018_fakebin/flux" "$t018_fakebin/talosctl" "$t018_fakebin/curl"
t018_cfg="$t018_tmp/cfg"
mkdir -p "$t018_cfg"
printf 'apiVersion: v1\nclusters: []\ncontexts: []\nusers: []\n' > "$t018_cfg/reuse.kubeconfig"
printf 'context: appliance\n' > "$t018_cfg/reuse.talosconfig"
t018_output="$(
  set +e
  PATH="$t018_fakebin:$PATH" \
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 1.0-rc5 \
    --bootstrap-mode recover \
    --node-ip 192.0.2.77 \
    --repo-url https://github.com/example/alga-psa.git \
    --repo-branch main \
    --kubeconfig "$t018_cfg/reuse.kubeconfig" \
    --talosconfig "$t018_cfg/reuse.talosconfig" \
    --config-dir "$t018_tmp/site" \
    2>&1
  echo "exit_code:$?"
)"
require_text "$t018_output" "Release artifact warning: one or more background image tags are missing:"
require_text "$t018_output" "ghcr.io/nine-minds/workflow-worker:61e4a00e"
require_text "$t018_output" "ghcr.io/nine-minds/temporal-worker:61e4a00e"
require_text "$t018_output" "Background image issues will be reported by appliance status and do not block core login readiness."
require_text "$t018_output" "exit_code:0"

# T019: Flux tiered dependencies and status tiering semantics remain non-login-blocking for background failures.
require_text "$(cat "$ROOT/ee/appliance/flux/base/flux/kustomizations.yaml")" "name: alga-platform"
require_text "$(cat "$ROOT/ee/appliance/flux/base/flux/kustomizations.yaml")" "name: alga-core"
require_text "$(cat "$ROOT/ee/appliance/flux/base/flux/kustomizations.yaml")" "name: alga-background"
require_text "$(cat "$ROOT/ee/appliance/flux/base/flux/kustomizations.yaml")" "dependsOn:"
require_text "$(cat "$ROOT/ee/appliance/flux/base/flux/kustomizations.yaml")" "- name: alga-platform"
require_text "$(cat "$ROOT/ee/appliance/flux/base/flux/kustomizations.yaml")" "- name: alga-core"
node --test "$ROOT/ee/appliance/operator/tests/status.test.mjs" --test-name-pattern "T002:"

upgrade_tmp="$(mktemp -d)"
upgrade_dry_run_output="$(
  bash "$ROOT/ee/appliance/scripts/upgrade-appliance.sh" \
    --release-version 1.0-rc5 \
    --kubeconfig /tmp/example.kubeconfig \
    --config-dir "$upgrade_tmp" \
    --dry-run
)"

require_text "$upgrade_dry_run_output" "apply -k $upgrade_tmp"
require_text "$upgrade_dry_run_output" "appliance-release-selection"
require_text "$upgrade_dry_run_output" "reconcile helmrelease alga-core"

jq -e '.title == "Alga Talos Appliance Release Manifest"' "$ROOT/ee/appliance/releases/schema.json" >/dev/null
jq -e '.channel == "candidate"' "$ROOT/ee/appliance/releases/channels/candidate.json" >/dev/null
jq -e '.channel == "stable"' "$ROOT/ee/appliance/releases/channels/stable.json" >/dev/null
jq -e '.app.releaseBranch == "release/1.0-rc5"' "$ROOT/ee/appliance/releases/1.0-rc5/release.json" >/dev/null
jq -e '.app.images.algaCore == "a2cbb430"' "$ROOT/ee/appliance/releases/1.0-rc5/release.json" >/dev/null
yq eval '.customization' "$ROOT/ee/appliance/schematics/metal-amd64.yaml" >/dev/null
kubectl apply --dry-run=client -f "$ROOT/ee/appliance/manifests/local-path-storage.yaml" >/dev/null
kubectl apply --dry-run=client -f "$ROOT/ee/appliance/flux/base/platform/appliance-status.yaml" >/dev/null

cat <<'EOF'
appliance image scaffolding checks passed
EOF
