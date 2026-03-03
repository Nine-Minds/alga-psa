# Scratchpad - Ubuntu 24.04 k3s VM Appliance

## Metadata
- Date started: 2026-02-23
- Plan folder: `ee/docs/plans/2026-02-23-ubuntu-k3s-vm-appliance/`
- Related chart: `helm/` with base values at `helm/values.yaml`

## Decisions Locked So Far
1. Base OS: Ubuntu Server 24.04 LTS.
2. Kubernetes runtime: k3s for v1.
3. Upgrade control plane: GitOps pull model with Flux.
4. VM artifact targets: vSphere OVA and QCOW2.
5. Automation code location: `ee/` subtree under `ee/appliance/`.
6. Product posture: locked appliance, no customer host tweaking.
7. Topology path: start single-node, support migration to 3-node HA with embedded etcd.
8. Artifact distribution: hybrid model (vendor-hosted default plus signed offline bundle import).
9. Support policy: support `N`, `N-1`, and `N-2`.
10. Upgrade jump policy: sequential only (`N -> N+1`).

## Proposed Repository Layout
1. `ee/appliance/packer/`
2. `ee/appliance/cloud-init/`
3. `ee/appliance/k3s/`
4. `ee/appliance/gitops/`
5. `ee/appliance/scripts/`
6. `ee/appliance/releases/`

## Open Decisions To Finalize
1. Concrete endpoint names and ownership for vendor-hosted artifact storage.
2. Concrete endpoint names and operator flow for signed offline bundle distribution/import.
3. Exact release promotion cadence and approval gates for `candidate -> stable`.

## Risks / Gotchas
1. If stale image rebuild policy is not enforced, "always-current" requirement fails in practice.
2. If values overlays diverge from `helm/` baseline too much, maintenance cost rises.
3. Single-node defaults can block clean HA migration if datastore and scheduling assumptions are not made now.
4. Air-gapped or restricted-network customer sites require explicit mirror/import path from day one.

## Command Notes
1. Plan folder created:
- `mkdir -p ee/docs/plans/2026-02-23-ubuntu-k3s-vm-appliance`

## Next Implementation Sequence (High-Level)
1. Scaffold `ee/appliance` filesystem and script entrypoints.
2. Add Packer templates and autoinstall seed.
3. Add first-boot k3s + GitOps bootstrap flow.
4. Add release manifest schema + publication logic.
5. Add upgrade and rollback scripts.
6. Validate single-node install and HA migration path in test environment.
