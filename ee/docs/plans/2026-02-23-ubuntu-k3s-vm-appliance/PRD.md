# Ubuntu 24.04 k3s VM Appliance Automation PRD

## Metadata
- Status: Draft
- Date: 2026-02-23
- Scope Owner: EE Platform / Deployment
- Plan Folder: `ee/docs/plans/2026-02-23-ubuntu-k3s-vm-appliance/`

## Problem Statement
Alga PSA needs an enterprise-ready on-prem appliance delivery model that is repeatable, secure, and low-touch for MSP customers. Today there is no standardized automated pipeline that builds and ships VM images with the product pre-integrated into a supported Kubernetes runtime. This causes inconsistent installs, slower onboarding, and risky upgrades.

## User Value
1. New customers can deploy a known-good appliance image quickly with minimal manual steps.
2. Existing customers get a predictable, low-risk upgrade path.
3. Alga support can operate a single standardized deployment model across customer sites.
4. Enterprise customers can start single-node and later expand to a 3-node HA topology without replatforming.

## Goals
1. Produce automated, versioned Ubuntu 24.04 LTS VM images for `OVA` and `QCOW2`.
2. Bootstrap a single-node `k3s` host and deploy Alga PSA using existing `helm/` chart assets.
3. Establish a GitOps pull-based app deployment and upgrade flow.
4. Maintain an always-current image line for new installs (scheduled rebuilds + release channels).
5. Define and support a migration path from single-node to 3-node HA.

## Non-Goals
1. Supporting multiple Linux base distributions in v1.
2. Supporting both `k3s` and `microk8s` in v1.
3. Implementing customer-specific host customization workflows.
4. Implementing all HA automation details in v1; v1 requires a validated migration path and scripts.

## Target Users / Personas
1. Alga Release Engineer
- Builds and publishes appliance artifacts and release bundles.
2. MSP Deployment Engineer
- Imports appliance VM, performs site bootstrap, validates app availability.
3. Alga Support Engineer
- Executes scripted upgrade and rollback runbooks.
4. Enterprise MSP Ops Team
- Starts with single-node deployment and later migrates to 3-node HA.

## Current State
1. Primary Helm chart exists in `helm/` with base values in `helm/values.yaml`.
2. Enterprise assets and automation typically live under `ee/`.
3. No existing `ee/` appliance pipeline for Packer image builds or lifecycle runbooks.

## Proposed Solution Overview
Create an `ee/appliance/` subsystem that owns appliance build, bootstrap, release metadata, and lifecycle scripts.

Core architecture:
1. Image Build Layer
- `Packer` with Ubuntu 24.04 autoinstall/cloud-init to produce `OVA` and `QCOW2`.
2. Bootstrap Layer
- First-boot automation installs/pins `k3s`, installs GitOps controller, and applies cluster base config.
3. App Delivery Layer
- GitOps points to release bundle that deploys existing `helm/` chart with appliance-specific values overlay.
4. Release Layer
- Versioned release manifest with pinned image digests/checksums/signatures for reproducible rollout and rollback.

## Decision Defaults (Locked)
1. GitOps controller: Flux.
2. k3s HA datastore model: embedded etcd.
3. Artifact distribution model: hybrid (vendor-hosted default plus customer mirror/offline bundle option).
4. Supported release window: `N`, `N-1`, `N-2`.
5. Upgrade jump policy: sequential only (`N -> N+1`).
6. Air-gapped support in v1: supported via signed offline release bundle import.

## Functional Requirements

### FR-1 Image Build and Publication
1. Build pipeline outputs `OVA` and `QCOW2` artifacts from a single source template.
2. Artifacts include release metadata (`sha256`, version, build time, component versions).
3. Artifacts are published to a canonical artifact location and release channel aliases (`stable`, `candidate`).

### FR-2 Single-Node k3s Appliance Bootstrap
1. Appliance first boot initializes host prerequisites and installs pinned `k3s`.
2. Kubernetes reaches Ready state without manual package-level host changes.
3. Appliance installs Flux and begins sync to configured release source.

### FR-3 Application Deployment
1. Deploy application from root `helm/` chart.
2. Keep environment-specific overrides in appliance-owned values overlays.
3. Deploy command path is non-interactive and scriptable for support.

### FR-4 Upgrade and Rollback
1. Support app-only upgrades through GitOps desired-state update.
2. Support planned k3s and host image upgrade tracks with compatibility gates.
3. Provide documented rollback paths for app layer and image layer.
4. Enforce sequential application upgrade progression (`N -> N+1`) with no skipped minors.
5. Publish and enforce support policy for `N`, `N-1`, and `N-2`.

### FR-5 Always-Current New-Customer Image
1. Scheduled rebuild cadence produces a refreshed image line with security updates.
2. Latest patch image is install default for new sites.
3. Build pipeline prevents stale base image usage beyond policy threshold.

### FR-6 Path to 3-Node HA
1. Single-node install baseline must preserve compatibility with planned 3-node topology.
2. Provide scripted process to add nodes and transition control plane to HA mode using embedded etcd.
3. App values and scheduling policies support HA profile.

## Public Interfaces / Contracts
1. New script entrypoints under `ee/appliance/scripts/`:
- `build-images.sh`
- `publish-release.sh`
- `bootstrap-site.sh`
- `upgrade-site.sh`
2. Release manifest contract under `ee/appliance/releases/<version>/release.json`:
- `releaseVersion`
- `os.base`
- `os.artifacts[]`
- `k8s.distribution`
- `k8s.version`
- `app.chartPath`
- `app.valuesProfile`
- `images[]` (digest pinned)
- `upgradeFrom[]`
3. Appliance values overlays:
- `ee/appliance/gitops/values/single-node.yaml`
- `ee/appliance/gitops/values/ha-3node.yaml`

## Data / Integration Notes
1. Helm source chart remains at `helm/`.
2. `helm/values.yaml` remains base defaults; appliance overlays only include necessary deltas.
3. GitOps repository layout must support per-channel desired state references.

## Security and Compliance Requirements
1. Do not bake customer secrets into VM image.
2. Release artifacts must include checksums and signature verification metadata.
3. Runtime image references in Kubernetes manifests must be digest-pinned.
4. Upgrade flow must include preflight checks and explicit maintenance windows.

## Rollout Plan
1. Phase 1: Internal-only build and smoke test.
2. Phase 2: Pilot with friendly customer(s), single-node only.
3. Phase 3: General availability for single-node appliance.
4. Phase 4: Enterprise HA migration support GA.

## Risks and Mitigations
1. Risk: Image drift or unreproducible builds.
- Mitigation: pinned versions + deterministic build metadata + periodic rebuild policy.
2. Risk: Customer site connectivity constraints for GitOps pulls.
- Mitigation: support mirror/offline artifact import mode in release workflow.
3. Risk: Upgrade failures at customer sites.
- Mitigation: preflight checks + backup hooks + rollback runbook.
4. Risk: HA path complexity from initial single-node choices.
- Mitigation: enforce HA-compatible defaults from v1 and test migration path early.

## Open Questions
1. Select concrete implementation endpoint names for vendor-hosted artifact storage and mirror import tooling.
2. Define exact release cadence per channel (`candidate` and `stable`) and promotion approval gates.

## Acceptance Criteria / Definition of Done
1. CI can produce `OVA` and `QCOW2` artifacts from mainline code without manual edits.
2. New VM boots to Ready `k3s` and deploys app via GitOps from `helm/`.
3. App upgrade from release N to N+1 succeeds via supported command path.
4. Rollback to previous app release is documented and validated.
5. Single-node to 3-node migration runbook is documented and validated in test environment.
6. Plan artifacts (`PRD.md`, `features.json`, `tests.json`, `SCRATCHPAD.md`) remain synchronized.
