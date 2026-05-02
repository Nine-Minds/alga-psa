# Operator's Manual (Ubuntu Appliance)

This manual covers day-2 operation for installed Ubuntu appliances.

## Core Endpoints

- Setup/Status plane: `http://<node-ip>:8080`
- Setup flow: `http://<node-ip>:8080/setup?token=<setup-token>`
- Support bundle: `http://<node-ip>:8080/support-bundle?token=<status-token>`
- App updates: `http://<node-ip>:8080/updates?token=<status-token>`

## Status And Failures

Status reports:

- current phase and last action
- readiness tiers
- failure classification (`network`, `dns`, `github-release-source`, `k3s`, `flux`, `storage`, `app-bootstrap`, `app-readiness`, `background-services`)
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

## App-Channel Updates

Use updates UI to apply `stable` or `nightly` channel changes.

Update flow:

1. resolve selected channel metadata
2. apply Flux source/release selection
3. request Flux/Helm reconcile
4. store update history

This flow is application-only in v1.

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
