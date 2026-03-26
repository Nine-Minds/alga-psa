# Technical Reference

This reference explains how the appliance is structured and what the operator is interacting with behind the scenes.

It is intended for technical IT administrators, MSP technicians, support engineers, and anyone who needs a deeper understanding of the appliance model.

## Appliance Layers

The appliance has four main layers:

1. Talos OS
   - boots the node and Kubernetes control plane
2. Kubernetes and storage prerequisites
   - provides the cluster runtime and persistent volumes
3. Flux and Helm
   - reconcile the declared application release
4. Alga PSA workloads
   - `alga-core` and related services

The operator UI sits on top of these layers and hides the raw command surfaces for normal use.

## Core Directories

Relevant repo paths:

- `ee/appliance/`
  - appliance scripts, release manifests, Flux topology, operator entrypoint
- `ee/appliance/scripts/`
  - bootstrap, upgrade, reset, support bundle, image build
- `ee/appliance/releases/`
  - published appliance release manifests and channels
- `ee/appliance/flux/`
  - GitOps topology and profile values
- `ee/appliance/operator/`
  - TUI/CLI implementation
- `ee/docs/premise/`
  - deeper generic Talos appliance platform docs

## Appliance Release Model

An appliance release couples:

- Talos version
- Kubernetes version
- Talos ISO
- Talos installer image
- app release version
- app release branch
- exact pinned application image tags
- appliance values profile

The release contract is stored in:

```text
ee/appliance/releases/<release>/release.json
```

This is the authoritative install and upgrade contract.

Use the release manifest, not remembered ad hoc image tags or URLs.

For deeper release semantics:

- `../premise/talos-release-model.md`

## Config And Access Files

The bootstrap/operator flow persists appliance access files under:

```text
~/nm-kube-config/alga-psa/talos/<site-id>/
```

Typical contents:

- `controlplane.yaml`
- `talosconfig`
- `kubeconfig`
- `node-ip`
- `app-url`

These files are the durable operator access path. They should survive across sessions and should not be replaced with temporary working files.

## Bootstrap Model

Bootstrap is driven by:

- `ee/appliance/appliance tui`
- or the lower-level `ee/appliance/scripts/bootstrap-appliance.sh`

Bootstrap responsibilities include:

- generating machine config
- persisting Talos and Kubernetes access files
- applying Talos config
- installing storage prerequisites
- installing Flux
- rendering runtime values from the release manifest
- selecting the appliance release in-cluster
- waiting for initial application bootstrap

## Release Selection And Upgrades

Customer-facing upgrades are release-based, not raw-tag-based.

The operator upgrade flow selects a published appliance release and reconciles the cluster to it.

Important behavior:

- no automatic rollback loops
- failures should stop in place for support investigation
- support bundles are the preferred first artifact after failure

## Namespace Model

The appliance uses three key namespaces:

- `flux-system`
  - Flux controllers and Git source objects
- `alga-system`
  - appliance release coordination and Helm release state
- `msp`
  - primary PSA application workloads

The current operator workload view intentionally focuses on `msp` by default so the UI centers PSA runtime health rather than cluster internals.

## PSA Workloads

Common appliance workloads include:

- `alga-core`
- `db`
- `redis`
- `pgbouncer`
- `temporal`
- `workflow-worker`
- `email-service`
- `temporal-worker`

Health and logs for these are surfaced in the operator UI through `Status` and `Workloads`.

## Workload And Log Model

The workload view is backed by a kubectl adapter that:

- lists appliance-relevant pods
- normalizes pod status
- presents readiness, restart counts, and age

The log viewer is backed by kubectl log reads that:

- load a recent tail first
- append live lines while following
- pause live-follow when scrolled away from the bottom
- load older chunks on demand
- keep in-memory line windows bounded

This is deliberately a practical operator model, not a full cluster log backend.

## Networking Assumptions

The appliance assumes:

- stable host reachability during bootstrap
- either reserved DHCP or static networking for predictable first install
- a known public app URL configured during bootstrap

The app URL is injected into runtime values and used for public-facing application URL settings.

A changing node IP during bootstrap can break installation and operator access assumptions.

## Storage Assumptions

The single-node appliance flow installs a local-path style storage provisioner and verifies it before expecting the application to reconcile cleanly.

Persistent application state lives on PVC-backed storage. Reset and fresh-install flows must be treated carefully so existing data and credentials are not mixed unintentionally.

For deeper storage/bootstrap semantics:

- `../premise/talos-alga-bootstrap-and-persistence.md`

## Flux And Helm

Talos owns cluster bring-up. Flux owns application reconciliation.

Flux applies the appliance topology and Helm releases from:

- `ee/appliance/flux/base/`
- `ee/appliance/flux/profiles/talos-single-node/`

The operator status view summarizes Flux and Helm health, but the underlying deployment model remains GitOps-driven.

For deeper GitOps details:

- `../premise/talos-gitops-bootstrap.md`

## Support Bundles

Support begins with an exportable support bundle rather than a remote support tunnel.

The bundle is meant to capture enough data to diagnose:

- Talos host issues
- Kubernetes reachability problems
- Flux/Kustomization/Helm failures
- workload failures
- storage and bootstrap problems

For deeper support-bundle expectations:

- `../premise/talos-support-bundles.md`

## Lower-Level Commands

The operator UI is the preferred interface.

Lower-level scripts remain available:

- `ee/appliance/scripts/bootstrap-appliance.sh`
- `ee/appliance/scripts/upgrade-appliance.sh`
- `ee/appliance/scripts/reset-appliance-data.sh`
- `ee/appliance/scripts/collect-support-bundle.sh`

These are useful for:

- advanced support
- automation
- fallback operation when working outside the TUI

## Related Reading

- `README.md`
- `quick-start.md`
- `operators-manual.md`
- `../premise/README.md`
