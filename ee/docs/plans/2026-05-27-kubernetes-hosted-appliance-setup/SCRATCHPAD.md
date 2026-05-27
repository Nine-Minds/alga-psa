# Scratchpad — Kubernetes-Hosted Appliance Setup

- Plan slug: `2026-05-27-kubernetes-hosted-appliance-setup`
- Created: `2026-05-27`

## What This Is

Working notes for moving new Ubuntu/k3s appliance installs from a host-based setup service to a Kubernetes-hosted appliance control plane.

## Decisions

- (2026-05-27) Scope is **new installs only**. Existing installed appliances do not need migration in this phase.
- (2026-05-27) Use a hybrid bootstrap: host brings up minimal k3s and applies a baked local control-plane bundle; Flux/network is not required before setup UI is available.
- (2026-05-27) Keep a tiny host fallback/recovery path so support can reapply the baked control plane if the Kubernetes-hosted setup system breaks.
- (2026-05-27) Keep the control plane independent from the Alga PSA app namespace so app bootstrap failures do not take down setup/status.
- (2026-05-27) F001 boundary is encoded in `ee/appliance/host-service/bootstrap-boundary.mjs`: host bootstrap may only ensure k3s/API readiness, import baked images, apply installed-path storage/control-plane manifests, and report setup/fallback handoff. Setup/status/app bootstrap responsibilities are explicitly listed as Kubernetes control-plane work.
- (2026-05-27) F002/F005/F010 use `ee/appliance/control-plane/manifests`: a dedicated `alga-appliance-control-plane` namespace, `appliance-control-plane` service account, scoped ClusterRole for setup resources, host-backed control-plane state, a token Secret generated from the host token, and a single deployment exposing the baked control-plane image on host port `8080`.
- (2026-05-27) F003/F004 package the current UI/API together in `ee/appliance/control-plane/Dockerfile`: multi-stage build runs the static Next export from `ee/appliance/status-ui`, then the runtime image copies `ee/appliance/host-service/*.mjs`, serves `/opt/alga-appliance/status-ui/dist`, and starts `server.mjs` on port `8080`.
- (2026-05-27) F006 staging is handled by the Ubuntu ISO entrypoint `ee/appliance/ubuntu-iso/scripts/stage-host-artifacts.sh`, which delegates to `ee/appliance/scripts/stage-control-plane-bundle.sh`. It copies control-plane manifests to `/opt/alga-appliance/control-plane/manifests`, host-service `.mjs` helpers to `/opt/alga-appliance/host-service`, local-path storage to `/opt/alga-appliance/manifests/local-path-storage.yaml`, baked image archives to `/opt/alga-appliance/control-plane/images`, systemd/sysusers files for bootstrap + host agent, and writes `/opt/alga-appliance/control-plane/bundle.json`.
- (2026-05-27) F007/F008/F009/F017 are handled by `ee/appliance/scripts/bootstrap-control-plane.sh` and the updated console banner. The bootstrap script has a dry-run mode and performs only substrate readiness, staged image import, non-blocking installed-path storage manifest apply, control-plane apply, and handoff reporting. The full storage reconcile/smoke runs from the submitted setup workflow after the setup UI is available. The console now names k3s substrate, baked Kubernetes control plane, setup UI handoff, and the reapply fallback command.
- (2026-05-27) F011 token generation stays host-side so the console URL and pod validation share one token. `bootstrap-control-plane.sh` and `alga-control-plane-reapply` create/update the `appliance-setup-token` Secret from `/var/lib/alga-appliance/setup-token`, and the pod reads `/var/lib/alga-appliance-token/setup-token`. Token enforcement remains in existing `server.mjs` route checks.
- (2026-05-27) F012 state persistence uses a single-node hostPath mounted at `/var/lib/alga-appliance` instead of a PVC so setup UI startup does not depend on dynamic storage provisioning. The Kubernetes manifest points install state, setup inputs, and release selection at that host-backed path; `server.mjs` now passes `releaseSelectionFile`, `setupInputsFile`, and `stateFile` consistently to setup workflow, status, and support bundle paths.
- (2026-05-27) The control-plane pod no longer mounts `/etc/rancher/k3s/k3s.yaml`. `control-plane-entrypoint.sh` writes an in-cluster kubeconfig from the service account token to `/tmp/alga-appliance/kubeconfig`. V1 binds the service account to an explicit broad setup ClusterRole, not Kubernetes `cluster-admin`, because existing setup still shells out to `kubectl` and `flux install` for cluster-wide resources; narrowing RBAC is deferred until setup uses typed in-cluster APIs.
- (2026-05-27) Added small Option-B host diagnostics bridge: `alga-host-agent.service` runs `host-agent.mjs` on the host and listens on `/run/alga-appliance/host-agent.sock`. The socket is group-owned by reserved host group `alga-appliance` (GID `10001`) created via `/etc/sysusers.d/alga-appliance.conf`, matching the control-plane pod group. The control-plane pod mounts only `/run/alga-appliance`, and `support-bundle.mjs` calls `POST /v1/support-bundle` over the Unix socket for allowlisted host journal/systemd/network/disk diagnostics. If unavailable, it falls back to the previous host-diagnostics note.
- (2026-05-27) F013/F014 are covered by existing `setup-engine.mjs` workflow functions now packaged in the control-plane image: validation/persistence in `validateSetupInputs` and `persistSetupInputs`, Flux source in `applyFluxSource`, runtime values/release selection in `applyRuntimeValuesAndReleaseSelection` and `applyReleaseSelectionConfiguration`, and protected initial tenant/admin Secret rendering via `initialTenantSecretYaml` applied as Kubernetes Secret rather than host plaintext state.
- (2026-05-27) F015 status resilience relies on `status-engine.mjs` collecting app namespace, HelmRelease, pod, job, and failure diagnostics via bounded kubectl calls while still returning a snapshot from persisted setup state when app resources are missing/unhealthy.
- (2026-05-27) F016 fallback command lives at `ee/appliance/bin/alga-control-plane-reapply` and is staged to `/opt/alga-appliance/bin/alga-control-plane-reapply`. It re-imports baked control-plane image archives, reapplies local storage and control-plane manifests, and prints k3s/control-plane diagnostics without delete/reset operations.
- (2026-05-27) F018 support bundle now captures `alga-appliance-bootstrap.service` and k3s logs, control-plane resources/describes/current+previous logs in `alga-appliance-control-plane`, and app bootstrap resources in `msp` in addition to existing cluster/status diagnostics.
- (2026-05-27) F019 new-install primary host service is `ee/appliance/systemd/alga-appliance-bootstrap.service`, which runs token init and `bootstrap-control-plane.sh`. It does not start `host-service/server.mjs`; the API runs only inside the packaged Kubernetes control-plane image for the new path.
- (2026-05-27) F020 runbook added at `ee/docs/appliance/kubernetes-hosted-setup.md` with bootstrap layers, new-install-only boundary, setup URL/token behavior, fallback recovery, logs/diagnostics, support bundle, and fresh-install smoke expectations.
- (2026-05-27) Console-only boot-media identification now writes `/etc/alga-appliance/build-info.json` during ISO staging and prints `Build timestamp: ...` in the console banner. This is intentionally a simple ISO-time marker rather than a self-referential SHA.
- (2026-05-27) Screenshot validation exposed a real first-boot race/omission: `alga-appliance-bootstrap.service` could render the post-bootstrap banner without running `init-admin-credential.mjs`, leaving `Password: initialize pending`. Bootstrap now initializes the admin credential before its `ExecStartPost` console render; the separate console banner service remains idempotent.

## Discoveries / Constraints

- (2026-05-27) Current setup/status implementation is host-based under `/opt/alga-appliance/host-service`, `/opt/alga-appliance/status-ui/dist`, and `/opt/alga-appliance/scripts`.
- (2026-05-27) Current app-channel update code in `ee/appliance/host-service/update-engine.mjs` is application-only and does not update host setup assets.
- (2026-05-27) Recent live install issues showed that setup bugs like stale status caching and installed-path manifest mismatches are painful when setup is ISO-baked only.
- (2026-05-27) First setup UI must not depend on GitHub, DNS, registry pulls, Flux, or the Alga PSA application being healthy.
- (2026-05-27) Host-side banner scripts must remain compatible with the distro-provided Node version on Ubuntu 22.04; avoid newer syntax like optional chaining/nullish coalescing in boot-time scripts.

## Commands / Runbooks

- (2026-05-27) Existing status UI build validation: `cd ee/appliance/status-ui && npm run build`.
- (2026-05-27) Existing host-service test pattern: `node --test ee/appliance/host-service/tests/*.test.mjs` with `flux` mocked/stubbed where needed.
- (2026-05-27) Existing ISO path of interest: `ee/appliance/ubuntu-iso/scripts/build-ubuntu-appliance-iso.sh` and `ee/appliance/ubuntu-iso/scripts/stage-host-artifacts.sh`.
- (2026-05-27) `ee/appliance/ubuntu-iso/scripts/stage-host-artifacts.sh` now writes a build-info JSON file and can accept a fixed `ALGA_APPLIANCE_BUILD_TIMESTAMP` for deterministic test staging.
- (2026-05-27) F001 focused validation: `node --test ee/appliance/host-service/tests/bootstrap-boundary.test.mjs`.
- (2026-05-27) T002 manifest validation: `node --test ee/appliance/host-service/tests/control-plane-manifests.test.mjs`.
- (2026-05-27) F003/F004 package validation: `node --test ee/appliance/host-service/tests/control-plane-package.test.mjs`.
- (2026-05-27) UI build validation: `/home/robert/alga-psa/ee/appliance/status-ui/node_modules/.bin/next build`. Direct `npm run build` is blocked in this sandbox because `/snap/bin/npm` fails with snap confinement errors.
- (2026-05-27) F006 staging validation: `node --test ee/appliance/host-service/tests/control-plane-staging.test.mjs`.
- (2026-05-27) T001 bootstrap planning validation: `node --test ee/appliance/host-service/tests/bootstrap-control-plane-script.test.mjs`.
- (2026-05-27) Existing `t003-first-boot-smoke.test.mjs` could not complete in this sandbox because Node cannot bind local test ports (`listen EPERM` on `0.0.0.0:18081`). The console portion exposed an `os.networkInterfaces()` sandbox failure, fixed by falling back to `127.0.0.1`.
- (2026-05-27) Commit attempt failed in this sandbox: `git commit` could not create `.git/index.lock` because `.git` is mounted read-only. Source files were updated but no commit could be created from this agent environment.
- (2026-05-27) F011 focused validation: `node --test ee/appliance/host-service/tests/control-plane-manifests.test.mjs ee/appliance/host-service/tests/init-token.test.mjs`.
- (2026-05-27) F012 state path validation: `node --test ee/appliance/host-service/tests/control-plane-state-paths.test.mjs`.
- (2026-05-27) Attempted broader workflow validation with `node --test ee/appliance/host-service/tests/setup-engine.workflow.test.mjs`; it timed out/hung in this sandbox. The existing targeted workflow tests cover these paths but need a normal test environment to complete.
- (2026-05-27) F015 status validation: `node --test ee/appliance/host-service/tests/status-engine.test.mjs`.
- (2026-05-27) F016/T003 fallback and staging validation: `node --test ee/appliance/host-service/tests/control-plane-staging.test.mjs ee/appliance/host-service/tests/control-plane-reapply.test.mjs`.
- (2026-05-27) F018 support bundle validation: `node --test ee/appliance/host-service/tests/support-bundle.test.mjs`.
- (2026-05-27) F019/T007 primary-path and fallback validation: `node --test ee/appliance/host-service/tests/control-plane-staging.test.mjs ee/appliance/host-service/tests/new-install-primary-path.test.mjs ee/appliance/host-service/tests/control-plane-reapply.test.mjs`.
- (2026-05-27) T009 runbook validation: `node --test ee/appliance/host-service/tests/kubernetes-hosted-setup-doc.test.mjs`.
- (2026-05-27) T004 workflow validation: `timeout 20s node --test ee/appliance/host-service/tests/control-plane-workflow.test.mjs`.
- (2026-05-27) T006 UI package smoke validation: `node --test ee/appliance/host-service/tests/status-ui-package-smoke.test.mjs`. This relies on `ee/appliance/status-ui/dist`, which was generated with `./node_modules/.bin/next build` because `/snap/bin/npm` is broken in this sandbox.
- (2026-05-27) T008 fresh-install smoke harness added at `ee/appliance/tests/kubernetes-hosted-fresh-install-smoke.sh`; local validation used `node --test ee/appliance/host-service/tests/fresh-install-smoke-script.test.mjs`. The preflight mode is executable here; full VM `verify` mode must run in a real ISO/VM environment with SSH/kubectl access.

## Links / References

- `ee/appliance/host-service/`
- `ee/appliance/host-service/bootstrap-boundary.mjs`
- `ee/appliance/control-plane/manifests/`
- `ee/appliance/control-plane/Dockerfile`
- `ee/appliance/scripts/stage-control-plane-bundle.sh`
- `ee/appliance/scripts/bootstrap-control-plane.sh`
- `ee/appliance/bin/alga-control-plane-reapply`
- `ee/appliance/systemd/alga-appliance-bootstrap.service`
- `ee/docs/appliance/kubernetes-hosted-setup.md`
- `ee/appliance/tests/kubernetes-hosted-fresh-install-smoke.sh`
- `ee/appliance/status-ui/`
- `ee/appliance/scripts/install-storage.sh`
- `ee/appliance/ubuntu-iso/`
- `ee/appliance/releases/`
- `helm/templates/appliance-bootstrap-configmap.yaml`
- `helm/templates/jobs.yaml`

## Open Questions

- Single combined setup-api image serving UI assets, or separate UI/API containers?
- Expose setup on `:8080` via hostNetwork, NodePort, or another minimal exposure mechanism?
- Which state remains host-side for fallback versus moving fully into Kubernetes resources?
- Include signature verification for baked/updated control-plane bundle in v1, or defer to a follow-up setup-update feature?
