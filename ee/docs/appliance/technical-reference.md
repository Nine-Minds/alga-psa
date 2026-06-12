# Technical Reference

This reference explains the supported Ubuntu/k3s appliance model and the release artifacts operators interact with behind the scenes.

It is intended for technical IT administrators, MSP technicians, support engineers, and anyone who needs a deeper understanding of the supported appliance path.

## Supported Appliance Layers

The supported v1 appliance has four main layers:

1. Ubuntu Server 24.04 LTS
   - boots the host and runs the local setup/status service on port `8080`
2. k3s and storage prerequisites
   - provide the Kubernetes runtime and persistent volumes
3. Flux and Helm
   - reconcile the declared application release
4. Alga PSA workloads
   - `alga-core` and related services

The setup/status UI sits on top of these layers and hides raw command surfaces for normal use.

Talos artifacts still exist in this repository for legacy internal/support work, but they are not the supported customer install path for Ubuntu v1.

## Core Directories

Relevant repo paths:

- `ee/appliance/`
  - appliance release manifests, Flux topology, host service, Ubuntu ISO workspace, and legacy support scripts
- `ee/appliance/ubuntu-iso/`
  - Ubuntu installer ISO build workspace
- `ee/appliance/host-service/`
  - setup/status/update service used by the Ubuntu appliance
- `ee/appliance/releases/`
  - appliance release manifests and channel pointers
- `ee/appliance/flux/`
  - GitOps topology and profile values
- `ee/appliance/flux/profiles/single-node/`
  - values profile for the single-node appliance
- `ee/docs/premise/`
  - legacy Talos reference docs only

## Appliance Release Model

An appliance release couples:

- appliance release version
- app release version
- app release branch
- exact pinned application image tags
- appliance values profile

The release contract is stored in:

```text
ee/appliance/releases/<release>/release.json
```

This is the authoritative install and upgrade contract. Use the release manifest, not remembered ad hoc image tags or URLs.

The active release manifest no longer carries Talos ISO, Talos installer, Kubernetes version, or OS image metadata. Ubuntu/k3s host installation is handled by the appliance installer and host service, while application image selection is release-manifest driven.

Channels are separate pointers under:

```text
ee/appliance/releases/channels/<channel>.json
```

They select a `releaseVersion` and Flux source `repoBranch`.

## Config And Access Files

The Ubuntu appliance persists host/setup state under system paths such as:

```text
/etc/alga-appliance/
/var/lib/alga-appliance/
/opt/alga-appliance/
```

Common files include:

- setup inputs
- install state
- release selection
- setup/status tokens
- packaged Flux/profile/release assets

Legacy Talos scripts may still persist operator files under `~/.alga-psa-appliance/<site-id>/`, but that is not the primary supported Ubuntu install path.

## Bootstrap Model

Supported bootstrap is driven by the Ubuntu appliance setup/status service.

High-level responsibilities include:

- validate DNS and outbound access to GitHub/GHCR
- install k3s
- install storage prerequisites
- install Flux
- resolve channel and release metadata
- render runtime values from the selected release manifest
- apply release-selection ConfigMaps and secrets
- apply the Flux GitRepository/Kustomization source
- surface progress and blockers through the status UI

Legacy Talos bootstrap scripts remain in `ee/appliance/scripts/` for internal support and engineering fallbacks, but they should not be treated as the default customer workflow.

## Release Selection And Upgrades

Customer-facing upgrades are release-based, not raw-tag-based.

The setup/status service resolves a channel, fetches the selected release manifest, patches runtime values ConfigMaps with pinned image tags, records release selection, and asks Flux/Helm to reconcile.

Important behavior:

- no automatic rollback loops
- failures stop in place for support investigation
- support bundles are the preferred first artifact after failure

## Namespace Model

The appliance uses three key namespaces:

- `flux-system`
  - Flux controllers and Git source objects
- `alga-system`
  - appliance release coordination and Helm release state
- `msp`
  - primary PSA application workloads

The operator/status workload view intentionally focuses on `msp` by default so the UI centers PSA runtime health rather than cluster internals.

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

Health and logs for these are surfaced through the status/operator tooling.

## Workload And Log Model

The workload view is backed by Kubernetes reads that:

- list appliance-relevant pods
- normalize pod status
- present readiness, restart counts, and age

The log viewer is backed by Kubernetes log reads that:

- load a recent tail first
- append live lines while following
- pause live-follow when scrolled away from the bottom
- load older chunks on demand
- keep in-memory line windows bounded

This is deliberately a practical operator model, not a full cluster log backend.

## Networking Assumptions

The appliance assumes:

- stable host reachability during setup
- working DNS resolution for GitHub and GHCR
- outbound HTTPS access to GitHub/GHCR or a supported proxy path
- a known public app URL configured during setup

The app URL is injected into runtime values and used for public-facing application URL settings.

## Storage Assumptions

The single-node appliance flow installs local-path style storage and verifies it before expecting the application to reconcile cleanly.

Persistent application state lives on PVC-backed storage. Reset and fresh-install flows must be treated carefully so existing data and credentials are not mixed unintentionally.

## Flux And Helm

k3s provides the Kubernetes runtime. Flux owns application reconciliation.

Flux applies the appliance topology and Helm releases from:

- `ee/appliance/flux/base/`
- `ee/appliance/flux/profiles/single-node/`

The status view summarizes Flux and Helm health, but the underlying deployment model remains GitOps-driven.

## Support Bundles

Support begins with an exportable support bundle rather than a remote support tunnel.

The bundle is meant to capture enough data to diagnose:

- host and k3s reachability problems
- Flux/Kustomization/Helm failures
- workload failures
- storage and bootstrap problems

Legacy Talos node diagnostics may still be collected when a Talos context is explicitly supplied, but they are not part of the supported Ubuntu appliance baseline.

## Lower-Level Commands

The setup/status UI is the preferred interface.

Lower-level scripts remain available for advanced support and automation:

- `ee/appliance/scripts/upgrade-appliance.sh`
- `ee/appliance/scripts/reset-appliance-data.sh`
- `ee/appliance/scripts/collect-support-bundle.sh`

Talos-era scripts such as `bootstrap-appliance.sh` and `build-images.sh` are legacy/internal unless explicitly used by engineering or support.

## Related Reading

- `README.md`
- `quick-start.md`
- `operators-manual.md`
- `../premise/README.md` — legacy Talos reference only
