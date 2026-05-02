# PRD: Ubuntu-Based Alga Appliance Installer

## Status

Draft plan approved for implementation planning.

## Problem Statement

The current appliance path uses Talos as the operating system layer. Talos provides a strong immutable appliance model, but it is unfamiliar to many customer administrators and creates support friction around OS-level troubleshooting, DNS/networking behavior, and first-install expectations.

Alga needs an appliance install path that preserves the good parts of the Talos appliance work — release channels, early status visibility, app-only upgrades, and GitOps reconciliation — while moving the host operating system to Ubuntu Server for operational familiarity.

## Goals

- Replace the Talos appliance install path with a Ubuntu Server 24.04 LTS appliance path for v1.
- Provide a custom Ubuntu Server 24.04 LTS autoinstall ISO for new appliance installs.
- Keep the ISO focused on installing a predictable Ubuntu base host.
- Move appliance-specific installation into a first-boot setup/status service.
- Support an interactive first-run setup experience through both:
  - web UI at `http://<node-ip>:8080/setup`
  - console TUI fallback
- Install an opinionated single-node k3s cluster on the Ubuntu host.
- Install Flux and reconcile Alga appliance manifests from GitHub repo channel files.
- Preserve release channel semantics: `stable` and `nightly`.
- Keep app updates channel-based and status-UI-driven.
- Keep Ubuntu and k3s updates manual/support-run in v1.
- Preserve the status-plane model on `http://<node-ip>:8080`, separate from the main app.
- Make failures easier to understand by classifying install/status phases.

## Non-Goals

- Do not support Talos and Ubuntu as equal first-class appliance OS targets in this v1 plan; Talos should be retired from the supported appliance product path.
- Do not automate Ubuntu package upgrades in the appliance status UI.
- Do not automate k3s version upgrades in the appliance status UI.
- Do not support fully offline installs in v1.
- Do not create a dedicated release bucket or release service in v1.
- Do not require a customer-specific ISO for normal installs.
- Do not make background services block login readiness.

## Target Users and Personas

### Customer administrator

An MSP/customer admin installing Alga on VMware ESXi or a cloud VM provider. They are comfortable with Ubuntu and browser-based setup, but should not need Kubernetes expertise.

### Alga support engineer

A support engineer diagnosing install failures, networking/DNS issues, Flux reconciliation, bootstrap failures, and app readiness.

### Alga release engineer

An internal operator who publishes image tags and release/channel metadata, and validates that appliances can install and update through `stable` and `nightly`.

## User Flows

### New install: VMware ESXi or cloud VM

1. User creates a VM from the Alga Ubuntu appliance ISO.
2. Ubuntu autoinstall runs unattended.
3. VM reboots into installed Ubuntu Server 24.04 LTS.
4. Host-level `alga-appliance.service` starts and owns port `8080`.
5. Console displays node IP, setup URL, and setup token.
6. User opens `http://<node-ip>:8080/setup` or uses console fallback.
7. User confirms or enters:
   - release channel, default `stable`
   - app URL / hostname
   - DNS mode and DNS servers, defaulting to DHCP-provided resolvers when available and making custom DNS a deliberate choice
   - optional proxy settings if supported in the implementation
   - support/testing repo URL or branch override only when needed
8. Setup runs explicit preflight checks for DNS, GitHub release/channel access, GHCR access, and proxy/egress behavior before installing k3s.
9. Setup installs k3s.
10. Setup installs Flux.
11. Setup points Flux at the Alga GitHub repo and the selected channel/branch/path.
12. Setup applies runtime values and release selection.
13. Status page shows install progress.
14. User opens the main Alga app when login readiness is reached.

### Upgrade: app channel update

1. Admin opens `http://<node-ip>:8080` with the status token.
2. Admin opens Updates.
3. Admin selects `stable` or `nightly`.
4. Status service creates/runs a host-side or Kubernetes-backed update task.
5. Update resolves the selected channel from GitHub, applies release values, and requests Flux/Helm reconciliation.
6. Status UI shows progress and final readiness.

### Support diagnostics

1. Admin opens the status UI or console TUI.
2. Support can inspect current phase, last action, logs, k3s health, Flux state, HelmRelease state, pod status, bootstrap logs, network diagnostics, and disk usage.
3. Support can generate or request a support bundle.
4. Support bundle output should be a single archive suitable for upload to Alga support, with sensitive files redacted or excluded.

## Architecture

### High-level components

```text
Ubuntu Server 24.04 host
  systemd
    alga-appliance.service         # setup/status/update web service on :8080
    alga-appliance-console.service # console fallback/TUI
  k3s
    flux-system
    alga-system
    msp
  app
    Alga HelmReleases/manifests from GitHub channel source
```

### ISO layer

The custom ISO wraps Ubuntu Server 24.04 autoinstall/subiquity. Its responsibility is to install and harden a predictable host:

- opinionated partitioning
- base user/admin setup
- required packages
- network defaults suitable for DHCP-first installs
- host firewall defaults if applicable
- installation of Alga setup/status service artifacts
- enabling first-boot setup services

The ISO should not need customer-specific release metadata for normal installs.

### Host setup/status service

The host service is the durable appliance management plane. It owns `:8080` permanently.

Before k3s exists, it serves setup UI and setup APIs. After k3s exists, it reads local kubeconfig and reports appliance status, diagnostics, logs, readiness tiers, and updates.

Expected host paths should be defined during implementation, but conceptually include:

```text
/opt/alga-appliance/        # service code/scripts
/etc/alga-appliance/        # config, selected channel, install state
/var/lib/alga-appliance/    # generated state, tokens, logs, work dirs
/var/log/alga-appliance/    # setup/update logs if not journal-only
/etc/rancher/k3s/k3s.yaml   # k3s kubeconfig
```

### k3s profile

Use an opinionated single-node k3s install:

- k3s server, single node
- pinned k3s version
- Traefik disabled unless a later design requires it
- ServiceLB disabled unless a later design requires it
- local-path storage enabled/default
- kubeconfig at `/etc/rancher/k3s/k3s.yaml`
- host status service reads kubeconfig for diagnostics and updates

### GitOps/release source

v1 uses the GitHub repo directly. Setup resolves channel metadata from the repo and configures Flux to reconcile the appliance path.

Because GitHub/GHCR access is a hard v1 setup dependency, the setup engine must preflight this before k3s installation. The admin should not discover a proxy, DNS, or firewall problem only after Kubernetes is half-installed. Preflight should check DNS resolution, HTTPS connectivity to GitHub raw/repo endpoints, GHCR reachability, and the selected channel file before host mutation begins.

Channels remain:

```text
ee/appliance/releases/channels/stable.json
ee/appliance/releases/channels/nightly.json
```

Immutable release manifests remain:

```text
ee/appliance/releases/<release-version>/release.json
```

The installer should default to the public HTTPS GitHub URL rather than SSH-style origins.

### Status/readiness model

Preserve the readiness tiers introduced by the Talos appliance work:

- platform ready
- core ready
- bootstrap ready
- login ready
- background ready
- fully healthy

`LOGIN_READY` means the main business UI is usable. Email, Temporal, workflow-worker, and temporal-worker must not block login readiness.

## UX Requirements

### Console first-boot output

The console should clearly state that Ubuntu has installed and appliance setup is waiting for user input. It should show:

- detected node IP
- setup URL
- setup token
- how to start console fallback
- where logs are available

### Web setup UI

The web setup UI should be primary. It should:

- require a setup token
- guide the admin through required fields
- default channel to `stable`
- default DNS mode to DHCP/system-provided resolvers when available
- make DNS configuration prominent, because MSP environments often depend on AD-integrated, split-horizon, or internal DNS
- allow explicit custom DNS values, with examples such as `8.8.8.8,8.8.4.4`, but avoid silently overriding customer internal DNS by default
- present `nightly` as non-production/testing/support-directed
- run release-source connectivity preflight before installing k3s
- show progress after setup starts
- avoid making the user believe the main app is ready before bootstrap starts

### Console fallback

The console fallback should collect the same required values as the web setup and start the same setup engine.

The implementation should be usable from common appliance access paths: physical/virtual display console, VMware/UTM/cloud console, and serial console when configured. The console service should not be the only setup path; headless/racked deployments should be able to use the browser flow from a workstation on the same network. The console experience may be a TUI on the active console or a serial-friendly prompt flow, but it must share validation and setup logic with the web UI.

### Status UI

After setup begins, port `8080` should show status/progress. Once setup completes, the same URL remains the status, diagnostics, logs, and updates UI.

## Failure Handling

The host status service should classify failures by phase:

- network
- DNS
- GitHub/release source
- k3s
- Flux
- storage
- app bootstrap
- app readiness
- background services

For each failure, show:

- current phase
- last action
- relevant logs
- suspected cause
- suggested next step
- whether retry is safe
- support bundle command/button

### Support bundle design

Support bundle generation is a first-class v1 requirement. The status UI should expose a one-button generation flow, and the host should also expose a documented one-command fallback.

Minimum bundle contents:

- appliance install state and phase-classified error summary
- `alga-appliance.service` and console service journal excerpts
- setup/update logs
- k3s node status and version
- k3s service status
- Kubernetes namespaces, pods, deployments, statefulsets, jobs, PVCs, and recent events
- Flux GitRepository/Kustomization status and relevant controller logs
- HelmRelease status and relevant reconciliation messages
- Alga bootstrap job status and logs
- network diagnostics: IP addresses, routes, DNS resolver configuration, DNS lookup checks, GitHub/GHCR connectivity checks
- disk and filesystem usage
- selected channel/release metadata with secrets redacted

The bundle must avoid including unrelated host secrets and should redact known tokens, passwords, kubeconfig client keys, and status/setup tokens unless explicitly requested by support.

## Data and Configuration

Implementation should define concrete schemas for:

- setup inputs
- install state
- selected channel/release
- status token
- update job/history
- support bundle metadata

Secrets and tokens must be stored with restricted filesystem permissions.

## Talos Retirement Scope

Ubuntu is not an additional appliance option for v1; it replaces Talos as the supported appliance OS path. Implementation should remove, retire, or clearly mark legacy Talos-specific appliance flows so customers and support are not choosing between two supported installers.

Talos-specific items to retire from the supported appliance surface include:

- Talos bootstrap/operator flows for new installs
- Talos machine config generation as a required appliance path
- `talosctl` as a customer prerequisite for the Ubuntu appliance
- Talos-specific install docs and troubleshooting as current customer guidance
- status checks that require Talos APIs or Talos config
- appliance assumptions tied to Talos host networking, maintenance mode, or machine config

Reusable work from the Talos effort should be preserved where it remains valuable:

- immutable release manifests
- `stable` and `nightly` channels
- Flux/GitOps reconciliation model
- readiness tiers and login-readiness semantics
- status/update UX concepts
- support diagnostics patterns

Existing local/lab Talos appliances may remain as historical or development artifacts, but the v1 product direction should not require maintaining Talos and Ubuntu as parallel supported appliance implementations.

## Rollout and Migration Notes

- This plan replaces the supported appliance install path with Ubuntu; it does not migrate existing Talos appliances in v1.
- Existing Talos release channel metadata should be reused where possible.
- The existing status/update concepts should be ported to a host-level service rather than discarded.
- The existing PR for Talos/status work may still be useful as the source of release/channel/status logic.
- Documentation should clearly state that Ubuntu is the current supported appliance path and that Talos appliance artifacts are legacy/internal unless explicitly handled by support.

## v2 Update Direction

v1 deliberately limits automated updates to Alga application/channel updates. That is a short-term liability because Ubuntu and k3s security updates will otherwise require support-run processes.

The expected v2 direction is to design managed appliance maintenance windows that can:

- check Ubuntu package update availability and security advisories
- check supported k3s upgrade targets
- run preflight backup/snapshot checks
- apply OS package updates with clear reboot requirements
- apply k3s upgrades only along validated version paths
- report maintenance history in the status UI
- provide rollback/remediation guidance when a host update fails

This v2 work is intentionally not in scope for the first Ubuntu appliance implementation, but the v1 host service should store enough version and maintenance metadata to support it later.

## Risks

- Retiring Talos reduces the parallel support matrix but may strand existing experimental Talos appliance work unless reusable pieces are deliberately ported.
- Ubuntu introduces more mutable host state than Talos.
- k3s install failures may vary by host networking, DNS, and firewall setup.
- Direct GitHub dependency means first install requires outbound access to GitHub and GHCR; setup must fail fast and clearly when this is blocked.
- Defaulting to public DNS can break MSP environments with AD-integrated, split-horizon, or internal DNS, so DNS must default to DHCP/system resolvers and be explained prominently.
- Host-level status service must be secured because it can expose logs and trigger updates.
- Keeping app updates automated while OS/k3s updates are manual creates operational/CVE response burden and requires clear docs plus a v2 update roadmap.

## Acceptance Criteria

- A VM can boot the custom Ubuntu ISO and complete unattended Ubuntu Server 24.04 install.
- After reboot, the console displays setup URL and token.
- Web setup can configure and start appliance install without silently overriding internal DNS.
- Console fallback can configure and start the same install flow from VM console or serial-console-style access.
- Setup preflights DNS, GitHub, GHCR, and selected channel access before k3s installation.
- Setup installs k3s with the agreed v1 profile.
- Setup installs Flux and reconciles Alga manifests from GitHub.
- Status UI remains available on host port `8080` before and after k3s install.
- Status UI shows install phases, logs, blockers, readiness tiers, pod/Flux/Helm health, support guidance, and support bundle generation.
- Main app reaches login readiness through the `stable` channel.
- Background service failures do not block login readiness.
- Status UI can apply an app-channel update for `stable` or `nightly`.
- Reboot preserves k3s, Flux, app state, and host status service state.
- Supported appliance docs and CLI flows no longer present Talos bootstrap as a v1 customer install option.
- Reused release/channel/status logic functions on Ubuntu without Talos APIs, Talos machine config, or `talosctl`.
