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
