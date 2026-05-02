# Scratchpad: Ubuntu-Based Alga Appliance Installer

## Context

We are pivoting the appliance host OS from Talos to Ubuntu for operational familiarity while preserving the appliance concepts developed in the Talos work:

- early status UI on port `8080`
- status UI separate from the main app
- readiness tiers
- stable/nightly release channels
- immutable release manifests
- app-only status-driven updates
- login readiness that does not depend on background services

## Decisions

### D001 — Use Ubuntu Server 24.04 LTS for v1

Use Ubuntu Server 24.04 LTS only for the first version. Avoid supporting 22.04 and 24.04 simultaneously until the appliance path is stable.

### D002 — Use custom autoinstall ISO

The ISO handles the OS layer: Ubuntu install, partitioning, packages, users/hardening, and first-boot service enablement.

The appliance bootstrap handles the app layer: k3s, Flux, channel resolution, values, release selection, and Alga workloads.

### D003 — Use interactive first-boot setup

Do not require a fully zero-touch install. First boot should offer both:

- web setup primary at `http://<node-ip>:8080/setup`
- console TUI fallback

### D004 — Use online install from GitHub channel files

v1 should fetch channel/release metadata directly from the GitHub repo instead of using a release bucket or fully bundled/offline release artifacts.

### D005 — Keep host service as durable status/update plane

The host-level systemd service permanently owns `:8080`. It serves setup before k3s exists and status/diagnostics/updates after k3s exists.

### D006 — Use opinionated k3s single-node install

Use k3s rather than kubeadm/RKE2. Disable unneeded bundled components where appropriate, keep local-path storage, and pin version.

### D007 — App-only updates in v1

Status UI should update Alga app/channel state only. Ubuntu package updates and k3s updates are manual/support-run in v1.

### D008 — DNS default

Do not default to public Google DNS. MSP environments often rely on AD-integrated, split-horizon, or internal DNS. Setup should default to DHCP/system-provided resolvers when available, make DNS selection prominent, and require deliberate admin choice before overriding with public resolvers such as `8.8.8.8,8.8.4.4`.

### D009 — Fail fast on GitHub/GHCR dependency

v1 intentionally depends on GitHub/GHCR for online install. Setup must preflight DNS, GitHub raw/repo access, selected channel metadata, GHCR reachability, and proxy/egress behavior before installing k3s or otherwise mutating the host.

### D010 — Name OS/k3s update liability and sketch v2

App-only updates are acceptable for v1, but manual/support-run Ubuntu and k3s updates create CVE-response burden. The PRD now names this explicitly and includes a v2 managed maintenance direction.

### D011 — Support bundle is first-class

Support bundle generation should be designed as a v1 feature, not a vague future helper. It must include host logs, setup/update logs, k3s state, Kubernetes resources/events, Flux/Helm status, app bootstrap logs, network diagnostics, disk usage, release metadata, and redaction.

### D012 — Console fallback must work for headless/racked deployments

Console fallback should work from common hypervisor console and serial-console-style access paths, but web setup remains primary so racked/headless users are not forced into physical keyboard/monitor workflows.

### D013 — Retire Talos as the supported appliance path

Ubuntu replaces Talos for the supported v1 appliance product. The plan should not leave Talos and Ubuntu as parallel customer-facing install options. Retire or clearly mark Talos bootstrap/operator/docs/status dependencies as legacy/internal, while porting reusable release/channel/status concepts to the Ubuntu host-service implementation.

## Open Questions

- What exact k3s version should be pinned for the first Ubuntu appliance validation?
- Which k3s bundled components must remain enabled for our current Helm/app exposure model?
- Should the first implementation use the existing Next.js status UI, a smaller host-native Node service, or another host service shape?
- What exact host paths should be considered stable public/support contract?
- Do we need proxy support in v1, or can it be deferred?
- What is the desired appliance admin Linux user name and authentication posture?
- What firewall defaults should be applied on Ubuntu?
- Should port `3000` remain the initial app port for v1, or should Ubuntu appliance introduce HTTP/HTTPS fronting from day one?

## Useful Existing Files

From the Talos/status work, likely useful source material:

```text
ee/appliance/scripts/bootstrap-appliance.sh
ee/appliance/scripts/upgrade-appliance.sh
ee/appliance/status-ui/
ee/appliance/flux/base/
ee/appliance/releases/channels/stable.json
ee/appliance/releases/channels/nightly.json
ee/appliance/releases/<version>/release.json
ee/appliance/operator/lib/status.mjs
ee/appliance/operator/lib/tui.mjs
```

## Implementation Notes To Carry Forward

- Flux needs a full URL format; do not pass GitHub scp-style URLs like `git@github.com:Nine-Minds/alga-psa.git` directly to Flux.
- First install failures should fail early and clearly for missing/wrong Flux CLI, DNS, GitHub access, and GHCR access.
- GitHub/GHCR preflight should happen before k3s install, not after Kubernetes is half-configured.
- Existing Talos bootstrap had a `--dns-servers` flag that patched both Talos resolver config and CoreDNS. Ubuntu setup needs equivalent host/k3s/CoreDNS treatment, but must not silently replace internal DNS with public DNS.
- Talos-specific customer-facing docs, prerequisites (`talosctl`), machine config generation, and Talos API status checks should not remain in the supported Ubuntu appliance path.
- Kubernetes does not expose byte-level image pull percentages; status should show phase/image/elapsed time instead.
- Background service failures should produce ready-with-background-issues, not block login readiness.

## Validation Targets

Minimum live validation environment should include:

- UTM local VM for rapid iteration if feasible
- VMware ESXi-like VM path or equivalent cloud custom ISO path before customer docs are finalized
- Fresh install with DHCP/system DNS defaults
- Fresh install with internal/split-horizon DNS preservation
- Fresh install with DNS failure simulation
- Fresh install with GitHub/GHCR/proxy failure simulation before k3s installation
- Reboot persistence test
- App-channel update test

## Implementation Log

- (2026-05-01) **F001 completed**: Defined a concrete Ubuntu appliance ISO build layout under `ee/appliance/ubuntu-iso/` with the initial folder contract (`config/nocloud`, `overlay`, `scripts`, `work`, `output`) and a single entrypoint script `scripts/build-ubuntu-appliance-iso.sh`.
- Rationale: The repo previously had Talos image-factory build paths only; no Ubuntu ISO structure existed, so downstream autoinstall and first-boot work had no stable location.
- Added `ee/appliance/ubuntu-iso/README.md` to declare responsibilities/inputs/outputs for the Ubuntu ISO path and to separate scaffold-vs-full-remaster expectations.
- Added dry-run validation command for repeatability: `ee/appliance/ubuntu-iso/scripts/build-ubuntu-appliance-iso.sh --base-iso <ubuntu.iso> --release-version <version> --dry-run`.
- Gotcha: full ISO remastering tools (`xorriso`, `7z`, boot catalog regeneration) are intentionally deferred to subsequent features; the current script validates layout and interface so later steps can land without path churn.
- (2026-05-01) **F002 completed**: Added Ubuntu 24.04 autoinstall NoCloud seed at `ee/appliance/ubuntu-iso/config/nocloud/user-data` + `meta-data`.
- Scope covered: unattended install defaults (locale/timezone), direct full-disk partitioning policy, base appliance admin account, required utility packages, and first-boot service enablement hooks for `alga-appliance.service` and `alga-appliance-console.service`.
- Security/operations note: appliance state directories are created in install-time late commands with root ownership and restricted permissions (`0750` for `/etc/alga-appliance`, `/var/lib/alga-appliance`, `/var/log/alga-appliance`).
- Build entrypoint hardening: `build-ubuntu-appliance-iso.sh` now fails fast if `config/nocloud/user-data` or `meta-data` are missing.
- (2026-05-01) **F003 completed**: Implemented host artifact packaging flow with `ee/appliance/ubuntu-iso/scripts/stage-host-artifacts.sh`.
- Packaging behavior: stages `ee/appliance/appliance`, `ee/appliance/operator/`, `ee/appliance/scripts/`, and built `ee/appliance/status-ui/dist` into `ee/appliance/ubuntu-iso/overlay/opt/alga-appliance/` for ISO-installed host delivery.
- `build-ubuntu-appliance-iso.sh` now enforces presence/executability of the staging script and runs it during non-dry-run builds.
- Gotcha: `status-ui/dist` is expected to exist at packaging time; staging warns if missing so CI/release automation must build status-ui first.
- (2026-05-01) **F004 completed**: Added host web service systemd unit at `ee/appliance/ubuntu-iso/overlay/etc/systemd/system/alga-appliance.service` bound to port `8080`.
- Added host runtime skeleton at `ee/appliance/host-service/server.mjs` (HTTP server with setup/status mode detection via `/var/lib/alga-appliance/install-state.json` and `/healthz` endpoint).
- Updated artifact staging to package `ee/appliance/host-service/` into `/opt/alga-appliance/host-service` on the target host.
- Validation run: `curl http://127.0.0.1:8080/healthz` returned `{"ok":true,"mode":"setup"}` while running `server.mjs` locally.
- (2026-05-01) **F005 completed**: Added console fallback startup path at `ee/appliance/ubuntu-iso/overlay/etc/systemd/system/alga-appliance-console.service`.
- Added serial/console-friendly output entrypoint `ee/appliance/host-service/console.mjs` (prints node IP, setup URL, setup token path value, and log command) while keeping web setup as the primary flow.
- Service shape is `Type=oneshot` with `StandardOutput=tty` to support VM/serial console display without replacing the web path on `:8080`.
- (2026-05-01) **F006 completed**: Added first-boot/setup token initializer `ee/appliance/host-service/init-token.mjs`.
- Token behavior: generates token when missing, persists to `/var/lib/alga-appliance/setup-token`, enforces restricted permissions (`0600` token file, `0750` parent directory) for sensitive status/setup access material.
- Wired token initialization into both systemd services via `ExecStartPre`, ensuring token existence before web setup/status or console fallback output starts.
- (2026-05-01) **F007 completed**: Console fallback output now prints detected node IP, setup URL (`http://<ip>:8080/setup`), setup token, and log locations (`journalctl -u alga-appliance.service -u alga-appliance-console.service -f`).
- (2026-05-01) **F008 completed**: Implemented token-protected web setup route `/setup` in `ee/appliance/host-service/server.mjs`.
- Behavior: `/setup` requires `?token=<setup-token>` matching `/var/lib/alga-appliance/setup-token`; mismatches return `401 Unauthorized`.
- Local validation: unauthenticated request returned HTTP 401; authenticated request returned HTTP 200.
- (2026-05-01) **F009/F010/F011 completed**: Expanded token-protected `/setup` UI with required fields: release channel, app URL/hostname, DNS mode, custom DNS servers, and support/testing repo URL + branch overrides.
- Defaults/UX semantics implemented:
  - channel defaults to `stable`
  - `nightly` explicitly labeled as testing/support-directed
  - DNS defaults to `Use DHCP/system resolvers`
  - custom DNS is opt-in and called out as deliberate (with example format guidance)
- (2026-05-01) **F013 completed**: Setup POST now validates and persists inputs to `/etc/alga-appliance/setup-inputs.json` (or `ALGA_APPLIANCE_SETUP_INPUTS_FILE` override), with restricted file permissions (`0600`) and restricted directory permissions (`0750`).
- (2026-05-01) **F012 completed**: Added console setup prompt flow `ee/appliance/host-service/console-setup.mjs` collecting the same required values as web setup.
- Shared validation/persistence: introduced `ee/appliance/host-service/setup-engine.mjs`; both web POST `/setup` and console prompt use the same `validateSetupInputs()` + `persistSetupInputs()` logic.
- Console-first guidance now includes explicit fallback command to launch interactive setup from VM/serial console.
- (2026-05-01) **F014 completed**: Implemented setup preflight engine execution in `ee/appliance/host-service/setup-engine.mjs` and wired it through both `server.mjs` (`POST /setup`) and `console-setup.mjs`.
- Preflight coverage now runs before any k3s mutation step: DNS resolution checks, GitHub channel metadata reachability/parse check, GHCR connectivity check, and proxy/egress environment context capture.
- Added phase-classified persisted install-state updates at `/var/lib/alga-appliance/install-state.json` with retry-safe blocker guidance for DNS/network/GitHub release-source failures.
- Web setup now returns an explicit preflight-blocked response (HTTP 412) with phase, cause, suggested next step, and retry safety; console setup prints matching blocker guidance.
- Added focused automated test file `ee/appliance/host-service/tests/setup-engine.preflight.test.mjs` validating custom DNS input enforcement and early DNS preflight blocking when no system resolvers exist.
- Validation run: `node --check ee/appliance/host-service/{setup-engine.mjs,server.mjs,console-setup.mjs}` and `node --test ee/appliance/host-service/tests/setup-engine.preflight.test.mjs`.
- (2026-05-01) **F015 completed**: Extended setup execution from preflight-only to workflow mode by adding `runSetupWorkflow()` and `installK3sSingleNode()` in `ee/appliance/host-service/setup-engine.mjs`.
- k3s install behavior: pinned default version `v1.31.4+k3s1` (overrideable via `ALGA_APPLIANCE_K3S_VERSION`), single-node server install command through `https://get.k3s.io`, and post-install kubeconfig verification at `/etc/rancher/k3s/k3s.yaml`.
- State modeling: writes explicit `k3s-install-running`, `k3s-install-complete`, and `k3s-install-blocked` phases with installer output/error guidance persisted into install-state.
- Wiring: both web setup (`server.mjs`) and console setup (`console-setup.mjs`) now invoke the full setup workflow path rather than only preflight.
- Added test `ee/appliance/host-service/tests/setup-engine.workflow.test.mjs` to validate successful k3s install path using a mocked local installer command and kubeconfig path.
- Validation run: `node --check ee/appliance/host-service/{setup-engine.mjs,server.mjs,console-setup.mjs}` and `node --test ee/appliance/host-service/tests/setup-engine.preflight.test.mjs ee/appliance/host-service/tests/setup-engine.workflow.test.mjs`.
- (2026-05-01) **F016 completed**: Updated default k3s install exec flags to disable unneeded bundled components by default (`--disable traefik --disable servicelb`) in `installK3sSingleNode()`.
- Added regression coverage in `ee/appliance/host-service/tests/setup-engine.workflow.test.mjs` to assert installer receives those disable flags through `INSTALL_K3S_EXEC` when no explicit override is supplied.
- (2026-05-01) **F017 completed**: Added post-k3s storage configuration phase `ensureLocalPathStorage()` in `setup-engine.mjs` and chained it into `runSetupWorkflow()` after successful k3s install.
- Storage behavior: executes host-side storage installer command (default `/opt/alga-appliance/scripts/install-storage.sh --kubeconfig /etc/rancher/k3s/k3s.yaml`) and persists storage phase state (`storage-config-running|complete|blocked`) with troubleshooting guidance on failures.
- Added automated test coverage for successful storage phase execution in `setup-engine.workflow.test.mjs`.
- (2026-05-01) **F018 completed**: Added Flux installation phase `installFlux()` to setup workflow after successful k3s + storage phases.
- Flux behavior: runs `flux install --namespace flux-system --kubeconfig /etc/rancher/k3s/k3s.yaml` by default, persists phase states (`flux-install-running|complete|blocked`), and records actionable failure details.
- Added test coverage in `setup-engine.workflow.test.mjs` for successful Flux phase execution via a mocked command.
- (2026-05-01) **F019 completed**: Added `resolveChannelMetadata()` phase that resolves selected channel metadata directly from GitHub channel files and extracts `releaseVersion` + `repoBranch` for workflow use.
- (2026-05-01) **F020 completed**: Added `applyFluxSource()` phase that applies Flux `GitRepository` + `Kustomization` resources against the selected branch/path (`./ee/appliance/flux/base`) using host kubeconfig.
- (2026-05-01) **F021 completed**: Flux source configuration now normalizes SSH-style GitHub URLs (`git@github.com:org/repo.git`) into public HTTPS format before applying source manifests.
- Added test coverage for channel metadata resolution and GitHub URL normalization in `ee/appliance/host-service/tests/setup-engine.workflow.test.mjs`.
- (2026-05-01) **F022 completed**: Added `applyReleaseSelectionConfiguration()` to persist selected channel/release and runtime values into `/etc/alga-appliance/release-selection.json` (0600/0750 permissions) for host-side release selection state.
- Setup workflow order now: preflight -> k3s -> storage -> Flux install -> channel metadata resolve -> Flux source apply -> release selection persistence.
- Added automated test coverage verifying persisted release-selection/runtime payload and state transition.
- (2026-05-01) **F023 completed**: Updated host-service mode detection so port `8080` transitions into status mode as soon as setup state exists (install started), rather than waiting for a terminal `complete` phase marker.
- Rationale: status/progress UX is now available immediately after setup begins, matching the requirement that host `:8080` remain the durable setup->status plane.
- (2026-05-01) **F024 completed**: Implemented host-side status collection in `ee/appliance/host-service/status-engine.mjs`, using local kubeconfig (`/etc/rancher/k3s/k3s.yaml`) and `kubectl` queries (nodes/pods) instead of Talos APIs.
- Added token-protected `/api/status` endpoint in `server.mjs` that returns install state + Kubernetes snapshot from the Ubuntu host service.
- Added unit test `ee/appliance/host-service/tests/status-engine.test.mjs` validating kubeconfig-driven status collection via mocked `kubectl` responses.
