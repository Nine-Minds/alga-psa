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
