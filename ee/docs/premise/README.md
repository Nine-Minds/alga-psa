# Talos Appliance Premises

This directory captures the stable operating model for running Alga PSA as a Talos-based appliance. The goal is to document the parts that should remain true across sites and releases, not the temporary details of one bootstrap session.

Use these docs for:

- Talos image and release design
- persistent machine configuration rules
- single-node GitOps deployment structure
- database bootstrap and persistence semantics
- common recovery and troubleshooting patterns

Do not put site-specific details here:

- node IPs
- local `talosconfig` or `kubeconfig` paths
- pane IDs
- one-off recovery commands tied to a single VM
- temporary image tags chosen for a specific test run

That operational context belongs in a local `alga-talos` skill or local runbook that can reference these documents.

## Documents

- [talos-release-model.md](/Users/roberisaacs/alga-psa.worktrees/feature/on-prem-enterprise-helm-install/ee/docs/premise/talos-release-model.md): how Talos ISO and installer artifacts are defined and paired
- [talos-host-configuration.md](/Users/roberisaacs/alga-psa.worktrees/feature/on-prem-enterprise-helm-install/ee/docs/premise/talos-host-configuration.md): what must live in Talos machine configuration for persistence across reboot
- [talos-gitops-bootstrap.md](/Users/roberisaacs/alga-psa.worktrees/feature/on-prem-enterprise-helm-install/ee/docs/premise/talos-gitops-bootstrap.md): how Flux and the appliance profile install the Alga stack
- [talos-alga-bootstrap-and-persistence.md](/Users/roberisaacs/alga-psa.worktrees/feature/on-prem-enterprise-helm-install/ee/docs/premise/talos-alga-bootstrap-and-persistence.md): first-run database setup, seed gating, and storage behavior
- [talos-support-bundles.md](/Users/roberisaacs/alga-psa.worktrees/feature/on-prem-enterprise-helm-install/ee/docs/premise/talos-support-bundles.md): bundle-first support posture and the minimum diagnostic payload
- [talos-operations-and-troubleshooting.md](/Users/roberisaacs/alga-psa.worktrees/feature/on-prem-enterprise-helm-install/ee/docs/premise/talos-operations-and-troubleshooting.md): layered checks and common failure modes

## Core Premises

The appliance path is built around these assumptions:

1. Talos OS artifacts are generated from an in-repo schematic and recorded in a release manifest.
2. The release manifest is the contract that couples the boot ISO and installer image.
3. Persistent host behavior belongs in Talos machine configuration, not temporary boot-time tweaks.
4. Application installation is GitOps-driven from `ee/appliance/flux/`.
5. Single-node appliance scheduling must be allowed on the control-plane node.
6. Initial application bootstrap is determined by database state, not by a Helm install event alone.
7. Database credentials and PVC-backed data must survive ordinary reconcile and restart cycles.
8. Application image tags must be provided explicitly per service; the appliance flow should not drift by defaulting to `latest`.
9. Support begins with an exportable bundle rather than a live support tunnel.
