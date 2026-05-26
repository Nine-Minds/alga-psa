# Legacy Talos Appliance Premises

> Legacy/internal only. Ubuntu Server 24.04 LTS with k3s is the supported customer appliance path for v1. These Talos docs are retained for historical context, support investigation of older internal environments, and engineering reference. Do not use this directory as the starting point for new customer installs.

This directory captures the historical operating model for running Alga PSA as a Talos-based appliance. The goal is to document the parts that were intended to remain true across Talos sites and releases, not the temporary details of one bootstrap session.

Use these docs only for:

- legacy Talos image and release design
- persistent Talos machine configuration rules
- historical single-node GitOps deployment structure
- database bootstrap and persistence semantics that may still inform Ubuntu/k3s support
- legacy recovery and troubleshooting patterns

Do not put site-specific details here:

- node IPs
- local `talosconfig` or `kubeconfig` paths
- pane IDs
- one-off recovery commands tied to a single VM
- temporary image tags chosen for a specific test run

That operational context belongs in a local `alga-talos` skill or local runbook that can reference these documents.

## Documents

- [talos-release-model.md](talos-release-model.md): historical Talos ISO and installer artifact model
- [talos-host-configuration.md](talos-host-configuration.md): Talos machine configuration persistence rules
- [talos-gitops-bootstrap.md](talos-gitops-bootstrap.md): historical Flux and appliance profile bootstrap model
- [talos-alga-bootstrap-and-persistence.md](talos-alga-bootstrap-and-persistence.md): first-run database setup, seed gating, and storage behavior
- [talos-support-bundles.md](talos-support-bundles.md): legacy bundle-first support posture
- [talos-operations-and-troubleshooting.md](talos-operations-and-troubleshooting.md): layered checks and common Talos failure modes

## Historical Premises

The Talos appliance path was built around these assumptions:

1. Talos OS artifacts are generated from an in-repo schematic and recorded in a release manifest.
2. The release manifest couples the boot ISO and installer image.
3. Persistent host behavior belongs in Talos machine configuration, not temporary boot-time tweaks.
4. Application installation is GitOps-driven from `ee/appliance/flux/`.
5. Single-node appliance scheduling must be allowed on the control-plane node.
6. Initial application bootstrap is determined by database state, not by a Helm install event alone.
7. Database credentials and PVC-backed data must survive ordinary reconcile and restart cycles.
8. Application image tags must be provided explicitly per service; the appliance flow should not drift by defaulting to `latest`.
9. Support begins with an exportable bundle rather than a live support tunnel.

For current supported appliance behavior, use `ee/docs/appliance/README.md` and related Ubuntu appliance docs instead.
