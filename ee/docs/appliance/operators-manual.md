# Operator's Manual (Ubuntu Appliance)

This manual covers day-2 operation for installed Ubuntu appliances.

## Core Endpoints

- Setup/Status plane: `http://<node-ip>:8080`
- Setup flow: `http://<node-ip>:8080/setup?token=<setup-token>`
- Support bundle: `http://<node-ip>:8080/support-bundle?token=<status-token>`
- App updates: Manage → Updates in the status UI (legacy form:
  `http://<node-ip>:8080/updates?token=<status-token>`)

## Status And Failures

Status reports:

- current phase and last action
- readiness tiers
- failure classification (`network`, `dns`, `registry-release-source`, `k3s`, `flux`, `storage`, `app-bootstrap`, `app-readiness`, `background-services`)
- suspected cause, suggested next step, retry safety, and log hints

## Support Bundle

Use the status UI button or API to generate a redacted support bundle.

Bundle includes:

- appliance install/update state
- host service journal excerpts
- k3s/cluster snapshots
- Flux and Helm status
- bootstrap logs
- network and DNS diagnostics
- disk usage
- release-selection metadata

## Updates And The Upgrade Path

The appliance does **not** update the Alga PSA application by itself. It checks
the selected release channel (`stable` or `nightly`), surfaces "Update
available" in the UI, and waits for an operator to apply the update. Moving
between versions — including minor jumps such as 1.1.x -> 1.2.x — is this same
operator-initiated flow: once the new release is published to your channel, the
appliance shows it as available and one click applies it. There is nothing to
stage or download manually.

What updates how:

- **Alga PSA application** (the version in Manage → Updates): operator-initiated.
  When the channel points at a newer release, the status Overview shows an
  "Update available" banner and the Manage button gains an indicator dot; the
  Manage → Updates tab shows the available version and a "Run update" button.
- **Appliance control plane** (the setup/status/manage UI on port `8080`):
  refreshed automatically at boot when the release channel is reachable — a
  registry failure keeps the currently installed image and never rolls back —
  and can also be upgraded in place from Manage → Control-plane.
- **Ubuntu OS and k3s**: not automated in v1; run them through
  support/operations procedures (see below).

Application update flow (what "Run update" does):

1. resolve selected channel metadata
2. apply Flux source/release selection
3. request Flux/Helm reconcile
4. store update history

This flow is application-only in v1: it moves all Alga PSA services to the
release pinned by the channel without touching the OS or k3s.

## OS/K3s Maintenance In v1

Ubuntu package updates and k3s upgrades are not automated in v1.
Run them through support/operations procedures.

Operational liability is explicit: CVE response for OS and k3s requires manual planning until v2 managed maintenance ships.

## v2 Direction

Planned v2 maintenance direction:

- managed maintenance windows
- OS/k3s preflight checks and version-path validation
- backup/snapshot checks
- maintenance history and remediation guidance
