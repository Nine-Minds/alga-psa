# SCRATCHPAD: Tiered Appliance Bootstrap Status

## Context

Plan created after a local UTM/Talos appliance bootstrap on the `feature/on-premise-email-processing` worktree exposed major bootstrap UX and reliability problems.

## Decisions

- Use approach C from brainstorming: status plane + tiered readiness + chart segmentation.
- Define `LOGIN_READY` as core business ready, not fully healthy.
- `LOGIN_READY` requires DB/bootstrap/web app/PgBouncer/Redis readiness but not email-service, Temporal, workflow-worker, temporal-worker, or optional integrations.
- Add a token-protected early status UI on `http://<node-ip>:8080`.
- Bootstrap should print the generated token so the admin has easy access without making diagnostics open on the LAN.
- First implementation should be hybrid: a small web service reads Kubernetes directly, but the status schema should be stable enough for a future controller/CRD.

## Observed Bootstrap Timeline and Findings

Environment:

- UTM VM: `Talos-Appliance`
- Node IP: `192.168.64.8`
- Talos: `v1.12.0`
- Kubernetes: `v1.31.4`
- Appliance release: `1.0-rc5`
- Repo branch used by Flux: `release/1.0-rc5`

What took time or failed:

1. Talos install initially blocked pulling `factory.talos.dev/metal-installer/...` because DNS lookup through `192.168.64.1:53` was refused.
2. Rerunning bootstrap with `--dns-servers 1.1.1.1,8.8.8.8` allowed Talos/Kubernetes to come up.
3. `ee/appliance/appliance bootstrap` generated Talos config and bootstrapped Kubernetes successfully, but fresh reset failed with `reset-appliance-data.sh: line 167: target: unbound variable`.
4. The operator wrapper later ignored or mishandled explicit kubeconfig/talosconfig reuse and overwrote the local Talos config, breaking `talosctl` auth while Kubernetes remained usable.
5. Script-level `ee/appliance/scripts/bootstrap-appliance.sh --bootstrap-mode recover --kubeconfig ...` continued the app install.
6. `alga-core` image pull took around 16 minutes for `ghcr.io/nine-minds/alga-psa-ee:94446747`.
7. `db-0` was stuck in `CreateContainerConfigError` with `failed to create subPath directory for volumeMount "db-data"`.
8. Manually creating `/mnt/data` in the Postgres PVC and deleting `db-0` fixed Postgres.
9. The first alga-core bootstrap job timed out waiting for Postgres; forcing a HelmRelease reconcile created revision 2, which completed migrations/seeds.
10. Bootstrap proof point: querying the `server` database showed `users` count `7`.
11. Alga web app responded at `http://192.168.64.8:3000` with a redirect to `/msp/dashboard`.
12. Temporal deployment initially did not run autosetup, causing `sql schema version compatibility check failed`.
13. Patching Temporal command to `/etc/temporal/entrypoint.sh autosetup` allowed Temporal to initialize.
14. Temporal UI failed with `cannot unmarshal !!str tcp://... into int`; disabling service links fixed it.
15. `email-service:61e4a00e` exists but first pull was canceled; deleting the pod allowed retry and it became Ready.
16. `workflow-worker:61e4a00e` was missing from GHCR and remained `ImagePullBackOff`.
17. `temporal-worker:61e4a00e` was also missing from GHCR; `temporal-worker:latest` existed.

## Useful Commands from Investigation

Check maintenance-mode Talos disk access:

```bash
talosctl get disks --insecure -n 192.168.64.8 -e 192.168.64.8
```

Bootstrap with explicit DNS:

```bash
ee/appliance/appliance bootstrap --bootstrap-mode fresh \
  --release-version 1.0-rc5 \
  --node-ip 192.168.64.8 \
  --hostname appliance-single-node \
  --app-url http://192.168.64.8:3000 \
  --interface enp0s1 \
  --network-mode dhcp \
  --dns-servers 1.1.1.1,8.8.8.8 \
  --install-disk /dev/sda \
  --repo-url https://github.com/nine-minds/alga-psa \
  --repo-branch release/1.0-rc5
```

Continue app install with existing kubeconfig:

```bash
ee/appliance/scripts/bootstrap-appliance.sh --bootstrap-mode recover \
  --release-version 1.0-rc5 \
  --site-id appliance-single-node \
  --profile talos-single-node \
  --node-ip 192.168.64.8 \
  --hostname appliance-single-node \
  --app-url http://192.168.64.8:3000 \
  --dns-servers 1.1.1.1,8.8.8.8 \
  --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig \
  --repo-url https://github.com/nine-minds/alga-psa \
  --repo-branch release/1.0-rc5
```

Fix observed Postgres subPath issue manually:

```bash
cat <<'EOF' | kubectl --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: db-subpath-fix
  namespace: msp
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: fix
          image: busybox
          command: ["sh", "-c", "mkdir -p /mnt/data && chmod 700 /mnt/data && chown 999:999 /mnt/data || true && ls -la /mnt"]
          volumeMounts:
            - name: db-data
              mountPath: /mnt
      volumes:
        - name: db-data
          persistentVolumeClaim:
            claimName: alga-core-sebastian-postgres-data
EOF
```

Force alga-core reconcile after DB fix:

```bash
flux --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig \
  -n alga-system reconcile helmrelease alga-core --reset --force --with-source --timeout=45m
```

Verify seeded users:

```bash
kubectl --kubeconfig ~/.alga-psa-appliance/appliance-single-node/kubeconfig -n msp exec db-0 -- \
  sh -c "PGPASSWORD=\$POSTGRES_PASSWORD psql -U postgres -d server -tAc 'select count(*) from users;'"
```

## Open Questions

- Should `appliance-status` be implemented in Node to match existing repo tooling, or Go for a tiny static binary?
- Should the status token use a bearer header, cookie-based login form, or both?
- Should status service use `hostNetwork: true`, NodePort, hostPort, or a lightweight local ingress path for port 8080?
- How much advanced diagnostics should be available in the first version versus deferred to support-bundle work?
- Should background services be installed by separate Flux Kustomizations immediately or should the first iteration only change readiness/status semantics?

## Next Implementation Planning Notes

Suggested implementation order:

1. Fix the immediate deterministic bugs from the observed run: reset helper, Talos config overwrite, Temporal autosetup/service links.
2. Add release image validation so missing background tags are detected before long waits.
3. Build shared status collector and blocker detector used by CLI.
4. Add early appliance-status chart/service.
5. Split Flux platform/core/background once status model is in place.

## 2026-04-29 Implementation Log

### Completed

- `F001`: Canonical appliance status JSON model now emitted by `collectStatus`.
- `F002`: Implemented tiered readiness rollups for platform/core/bootstrap/login/background/full health.
- `F003`: Implemented user-facing rollup classification for installing/ready/ready-with-issues/fully-healthy/failed-action-required.
- `F004`: Enhanced status CLI reporting to include canonical rollup and tier readiness details.
- `F005`: Enhanced bootstrap phase progress classification to include Storage, Core App, and Background Services.
- `F006`: Added bootstrap status token generation, local persistence, and CLI output of status URL/token.
- `F007`: Added in-cluster `appliance-system/appliance-status-auth` Secret creation for the status token.
- `T001`: Unit test added for canonical JSON shape in healthy synthetic fixture.
- `T002`: Unit test added for login-ready + background-failed rollup behavior.
- `T003`: Unit test added for core blocker producing failed/action-required rollup.

### What Changed

- Extended status collector output in `ee/appliance/operator/lib/status.mjs` with a canonical model at `status.canonical` containing:
  - `siteId`, `timestamp`
  - `release` metadata (`selectedReleaseVersion`, `appVersion`, `channel`, `gitRevision`)
  - `urls` (`statusUrl`, `loginUrl`)
  - `rollup` (`state`, `message`, `nextAction`)
  - `tiers` (platform/core/bootstrap/login/background/fullHealth)
  - `topBlockers`, `components`, `recentEvents`
- Preserved existing top-level status fields (`host`, `cluster`, `flux`, `workloads`, `release`, `topBlocker`, etc.) to avoid breaking current CLI/TUI consumers while introducing canonical shape.
- Added cluster event collection (`kubectl get events --sort-by=.metadata.creationTimestamp -A -o json`) and normalized event summaries.
- Added `T001` assertions in `ee/appliance/operator/tests/status.test.mjs` and mocked event query output.
- Refined tier calculations to enforce:
  - `core` requires db + redis + pgbouncer all ready.
  - `login` requires `core` + alga-core ready.
  - `background` computed independently from login-critical services.
  - `platform` depends on Talos/Kubernetes/Flux source health.
- Added `T002` case asserting `LOGIN_READY=true` and `BACKGROUND_READY=false` produce `ready_with_background_issues`.
- Added `T003` case asserting a core DB readiness failure keeps `LOGIN_READY=false` and emits `failed_action_required`.
- Updated `ee/appliance/operator/lib/format.mjs` so CLI/TUI summary includes canonical rollup lines and workload section includes tier readiness lines when canonical status is present.
- Updated `ee/appliance/operator/lib/lifecycle.mjs` bootstrap phase detector patterns to emit phase markers for `Storage`, `Core App`, and `Background Services`.
- Added lifecycle test coverage for new phase marker detection in `ee/appliance/operator/tests/lifecycle-cli.test.mjs`.
- Updated `ee/appliance/scripts/bootstrap-appliance.sh` with:
  - `generate_status_token` helper.
  - `STATUS_TOKEN_PATH` under site config (`~/.alga-psa-appliance/<site-id>/status-token` via resolved config dir).
  - `ensure_status_token` to reuse persisted token when present or generate a new token.
  - `ensure_status_auth_secret` to create/apply `appliance-system/appliance-status-auth` with `token` literal.
  - final CLI output block printing status URL (`http://<node-ip>:8080`) and token.
- Updated `ee/appliance/tests/run-plan-tests.sh` dry-run assertions to verify token/secret/status output lines.

### Decisions / Rationale

- Added canonical data as `status.canonical` instead of replacing the current status object to keep backward compatibility with existing formatter/TUI paths and allow incremental migration.
- Mapped `gitRevision` to release manifest branch metadata for now (`release.metadata.app.releaseBranch`) because manifests currently do not include a commit SHA field.

### Commands Run

- `node --test ee/appliance/operator/tests/status.test.mjs`
- `node --test ee/appliance/operator/tests/lifecycle-cli.test.mjs ee/appliance/operator/tests/format.test.mjs ee/appliance/operator/tests/status.test.mjs`
- `bash ee/appliance/scripts/bootstrap-appliance.sh --release-version 1.0-rc5 --bootstrap-mode fresh --node-ip 192.0.2.10 --hostname alga-appliance --app-url https://psa.example.test --interface enp0s1 --network-mode dhcp --repo-url https://github.com/example/alga-psa.git --repo-branch main --config-dir <tmp> --dry-run`

### Gotchas

- `kubeJson()` accepts resource tokens, so event retrieval with sort flags must use a direct `kubectl` command invocation rather than passing a combined pseudo-resource string.
- `ee/appliance/tests/run-plan-tests.sh` currently fails earlier in this environment with `release-version must follow x.y.z` from the build-images dry-run section, so bootstrap token behavior was validated using direct bootstrap dry-run invocation instead of full script pass.

### 2026-04-29 Additional Progress

- `F008`: Added early-installed `appliance-status` manifest set under Flux base platform resources with token-protected HTTP endpoints on node port `8080`.

### F008 Implementation Details

- Added `ee/appliance/flux/base/platform/appliance-status.yaml` containing:
  - `ServiceAccount` in `appliance-system`.
  - `Deployment` (`appliance-status`) using `node:20-alpine` with:
    - host exposure via `hostPort: 8080` for predictable `http://<node-ip>:8080` access.
    - token auth sourced from Secret `appliance-status-auth` key `token`.
    - Bearer token auth (`Authorization: Bearer <token>`) and query-token fallback (`?token=<token>`).
    - `GET /api/status` returning bootstrap placeholder JSON.
    - `GET /healthz` probes for liveness/readiness.
- Updated `ee/appliance/flux/base/kustomization.yaml` to include `platform/appliance-status.yaml` before app releases.
- Updated `ee/appliance/flux/base/namespaces.yaml` to include `appliance-system` namespace in GitOps-managed base.
- Extended `ee/appliance/tests/run-plan-tests.sh` to require and client-validate `flux/base/platform/appliance-status.yaml`.

### Validation Run

- `bash -n ee/appliance/scripts/bootstrap-appliance.sh`
- `kubectl apply --dry-run=client -f ee/appliance/flux/base/platform/appliance-status.yaml`
- `bash ee/appliance/tests/run-plan-tests.sh` (still fails in this environment at existing check: `release-version must follow x.y.z`)

### Notes / Gotchas

- This first `appliance-status` workload intentionally provides a minimal token-gated surface and placeholder `/api/status` payload; canonical collector wiring and full overview/diagnostics pages remain tracked by `F009` and `F010`.
- `hostPort: 8080` is used for deterministic access on single-node appliance installs where NodePort ranges would not map to `8080` by default.

- `F009`: Added token-protected overview page and overview API fields for install state, phase, login URL, and next action.

### F009 Implementation Details

- Extended `ee/appliance/flux/base/platform/appliance-status.yaml` server behavior:
  - New overview model with `installState`, `currentPhase`, `loginUrl`, `nextAction`, `message`, `timestamp`.
  - `GET /api/status` now includes overview-oriented fields.
  - Added `GET /api/overview` for explicit overview retrieval.
  - Root page (`/`) now renders a token-protected overview UI and loads data from `/api/overview`.
- Added `HOST_IP` env (from pod `status.hostIP`) and computed default login URL as `http://<host-ip>:3000`.

### Validation (F009)

- `kubectl apply --dry-run=client -f ee/appliance/flux/base/platform/appliance-status.yaml`

- `F010`: Added token-protected advanced diagnostics API/page with readiness tiers, component list, blockers/events arrays, and Flux/Helm snapshot model.

### F010 Implementation Details

- Extended `appliance-status` server with `readDiagnostics()` model and endpoint `GET /api/diagnostics` including:
  - `tiers`
  - `components`
  - `topBlockers`
  - `recentEvents`
  - `flux` (`source`, `helmReleases`)
- Added token-protected `/diagnostics` HTML page that fetches and renders diagnostics JSON for support/operator workflows.

### Validation (F010)

- `kubectl apply --dry-run=client -f ee/appliance/flux/base/platform/appliance-status.yaml`

- `F011`: Added explicit read-only RBAC for appliance-status status collection.

### F011 Implementation Details

- Added `ClusterRole` `appliance-status-readonly` and `ClusterRoleBinding` in `ee/appliance/flux/base/platform/appliance-status.yaml` for service account `appliance-system/appliance-status`.
- Read-only access granted (`get/list/watch`) for:
  - core resources: `nodes`, `pods`, `persistentvolumeclaims`, `events`, `configmaps`
  - batch: `jobs`
  - Flux source: `gitrepositories`
  - Flux kustomize: `kustomizations`
  - Flux helm: `helmreleases`
- No mutation verbs were granted.

### Validation (F011)

- `kubectl apply --dry-run=client -f ee/appliance/flux/base/platform/appliance-status.yaml`

- `F012`: Implemented DNS failure detection and DNS remediation blocker messaging.
- `T004`: Added unit test coverage for DNS resolver failure classification.

### F012/T004 Implementation Details

- Updated `ee/appliance/operator/lib/status.mjs`:
  - Added `cluster.apiError` capture from `/readyz` failures.
  - Added `detectDnsFailure(status)` scanning host/cluster/event/Flux/workload messages for DNS lookup failures (`lookup ... connection refused|no such host|server misbehaving|i/o timeout`).
  - Updated `determineTopBlocker` to prioritize DNS blockers with actionable remediation:
    - layer: `Platform DNS resolution`
    - nextAction: configure explicit DNS servers (e.g. `1.1.1.1,8.8.8.8`) and retry.
- Added `T004` test in `ee/appliance/operator/tests/status.test.mjs` with a realistic event message:
  - `lookup factory.talos.dev on 192.168.64.1:53: connection refused`
  - asserts blocker layer/reason/nextAction are DNS-specific.

### Validation (F012/T004)

- `node --test ee/appliance/operator/tests/status.test.mjs`

- `F013`: Implemented Postgres PVC/subPath blocker detection as a core login-blocking storage issue.
- `T005`: Added unit test coverage for subPath failure classification.

### F013/T005 Implementation Details

- Updated `ee/appliance/operator/lib/status.mjs`:
  - Added `detectPostgresSubPathFailure(status)` over recent Kubernetes event messages.
  - Prioritized Postgres subPath detection in `determineTopBlocker` with:
    - layer: `Core Postgres storage initialization`
    - reason includes matched subPath signal
    - nextAction guidance to repair/recreate Postgres PVC subPath and restart db pod.
- Added `T005` case in `ee/appliance/operator/tests/status.test.mjs`:
  - forces `db` not ready
  - injects event `failed to create subPath directory for volumeMount "db-data"`
  - asserts specialized core storage blocker is selected.

### Validation (F013/T005)

- `node --test ee/appliance/operator/tests/status.test.mjs`

- `F014`: Implemented missing-image-tag blocker detection with tier-aware login-blocking classification.
- `T006`: Added workflow-worker missing-tag unit coverage.
- `T007`: Added alga-core missing-tag unit coverage.

### F014/T006/T007 Implementation Details

- Updated `ee/appliance/operator/lib/status.mjs`:
  - Added `inferComponentFromObjectName()` for pod/deployment name mapping.
  - Added `detectMissingImageTag(status)` scanning recent event messages for image pull + `not found` patterns.
  - Enhanced `determineTopBlocker` to emit image-tag blocker details:
    - layer: `Image tag availability`
    - component: mapped component (e.g., `workflow-worker`, `alga-core`)
    - loginBlocking based on component tier (`background` -> false, core/login -> true)
    - actionable release-manifest/tag remediation guidance.
  - Updated canonical blocker projection to respect explicit `topBlocker.loginBlocking` and `topBlocker.component` when present.
- Added tests in `ee/appliance/operator/tests/status.test.mjs`:
  - `T006` verifies workflow-worker `not found` is non-login-blocking background blocker.
  - `T007` verifies alga-core `not found` is login-blocking blocker.

### Validation (F014/T006/T007)

- `node --test ee/appliance/operator/tests/status.test.mjs`

- `F015`: Implemented interrupted image-pull detection separate from missing-tag detection.
- `T008`: Added unit test for context-canceled image pull classification.

### F015/T008 Implementation Details

- Updated `ee/appliance/operator/lib/status.mjs`:
  - Added `detectInterruptedImagePull(status)` scanning event messages for pull interruptions (`context canceled`, `cancelled`, `context deadline exceeded`).
  - Prioritized interruption classification before missing-tag classification in `determineTopBlocker`.
  - Emits blocker:
    - layer: `Image pull interruption`
    - loginBlocking: `false`
    - retry-focused nextAction.
- Added `T008` in `ee/appliance/operator/tests/status.test.mjs`:
  - uses email-service event with `context canceled`
  - asserts interruption blocker layer/component/retryable guidance.

### Validation (F015/T008)

- `node --test ee/appliance/operator/tests/status.test.mjs`
