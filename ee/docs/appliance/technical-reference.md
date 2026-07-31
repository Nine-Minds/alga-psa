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

## Core Directories

Relevant repo paths:

- `ee/appliance/`
  - Flux topology, host service, Ubuntu ISO workspace, and support scripts
- `ee/appliance/ubuntu-iso/`
  - Ubuntu installer ISO build workspace
- `ee/appliance/host-service/`
  - setup/status/update service used by the Ubuntu appliance
- `ee/appliance/flux/`
  - GitOps topology and profile values
- `ee/appliance/flux/profiles/single-node/`
  - values profile for the single-node appliance
- `ee/docs/premise/`
  - legacy Talos reference docs only

## Appliance Release Model

An appliance release couples:

- appliance release version
- exact pinned application image tags
- control-plane image tag
- Flux config bundle digest
- chart versions
- appliance values profile and profile values

Release metadata is published as an OCI artifact:

```text
ghcr.io/nine-minds/alga-appliance-release:<version>
ghcr.io/nine-minds/alga-appliance-release:<channel>
```

The release manifest JSON is the OCI artifact config blob. Channels such as `stable` and `nightly` are OCI tags. The local `ee/appliance/releases` tree and local publish scripts have been removed.

Publishing is owned by the Argo workflow in:

```text
~/nm-kube-config/alga-psa/workflows/composite/alga-psa-build-migrate-deploy.yaml
```

For stable channel publishing, use:

```text
promote-release=true
publish-appliance-release=true
appliance-release-channel=stable
```

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
- packaged Flux/profile assets

## Bootstrap Model

Supported bootstrap is driven by the Ubuntu appliance setup/status service.

High-level responsibilities include:

- validate DNS and outbound access to GHCR
- install k3s
- install storage prerequisites
- install Flux
- resolve channel and release metadata from OCI
- render runtime values from the selected release manifest
- apply release-selection ConfigMaps and secrets
- apply the Flux OCIRepository/Kustomization source
- surface progress and blockers through the status UI

## Release Selection And Upgrades

Customer-facing upgrades are release-based, not raw-tag-based.

The setup/status service resolves a channel, fetches the selected release manifest from OCI, patches runtime values ConfigMaps with pinned image tags, records release selection, updates the pinned Flux config bundle digest, and asks Flux/Helm to reconcile.

Important behavior:

- no automatic rollback loops
- failures stop in place for support investigation
- support bundles are the preferred first artifact after failure

## Namespace Model

The appliance uses three key namespaces:

- `flux-system`
  - Flux controllers and OCI source objects
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
- working DNS resolution for GHCR
- outbound HTTPS access to GHCR or a supported proxy path
- a known public app URL configured during setup

The app URL is injected into runtime values and used for public-facing application URL settings.

## Storage Assumptions

The single-node appliance flow installs local-path style storage and verifies it before expecting the application to reconcile cleanly.

Persistent application state lives on PVC-backed storage. Reset and fresh-install flows must be treated carefully so existing data and credentials are not mixed unintentionally.

## Flux And Helm

k3s provides the Kubernetes runtime. Flux owns application reconciliation.

Flux applies the appliance topology and Helm releases from the pinned config bundle referenced by the selected release manifest. Source content corresponds to:

- `ee/appliance/flux/base/`
- `ee/appliance/flux/profiles/single-node/`

The status view summarizes Flux and Helm health, but the underlying deployment model remains GitOps-style reconciliation from OCI artifacts.

## Support Bundles

Support begins with an exportable support bundle rather than a remote support tunnel.

The bundle is meant to capture enough data to diagnose:

- host and k3s reachability problems
- Flux/Kustomization/Helm failures
- workload failures
- storage and bootstrap problems

## Lower-Level Commands

The setup/status UI is the preferred interface.

Lower-level scripts remain available for advanced support and automation:

- `ee/appliance/scripts/reset-appliance-data.sh`
- `ee/appliance/scripts/collect-support-bundle.sh`
- `ee/appliance/scripts/repair-release.sh`

Install and app-channel update flows are not driven by local lifecycle scripts in this repository.

## Related Reading

- `README.md`
- `quick-start.md`
- `operators-manual.md`
- `architecture.md`
- `../premise/README.md` — legacy Talos reference only
