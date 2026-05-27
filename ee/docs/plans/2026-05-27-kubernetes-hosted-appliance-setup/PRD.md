# PRD — Kubernetes-Hosted Appliance Setup

- Slug: `2026-05-27-kubernetes-hosted-appliance-setup`
- Date: `2026-05-27`
- Status: Draft

## Summary

Move the Alga PSA appliance setup/status/update system for new Ubuntu/k3s installs out of the host filesystem and into a small Kubernetes-hosted appliance control plane. The ISO should only perform a minimal, robust host bootstrap: install/start k3s, prepare local storage, load/apply a baked control-plane bundle, and expose setup on the existing appliance URL/port. The control plane then owns setup UI/API, status, diagnostics, release selection, and application bootstrap.

## Problem

The current setup system is baked into `/opt/alga-appliance` and run by systemd on the host. That makes setup bugs hard to fix on deployed appliances and couples first boot, setup UI, status logic, storage scripts, and release orchestration to the ISO contents. Recent issues showed that small setup bugs, such as stale status caching or incorrect manifest paths, require manual host patching or ISO rebuilds.

If Kubernetes bringup is made deliberately simple and the setup/control plane runs inside Kubernetes, setup itself can be versioned, updated, rolled back, and operated using the same primitives as the rest of the appliance.

## Goals

- For new installs, reduce host bootstrap to a minimal Kubernetes substrate and a local handoff to a Kubernetes-hosted control plane.
- Ship a baked, offline-capable control-plane bundle in the ISO so first setup does not require GitHub, DNS, registry pulls, or Flux.
- Run setup UI/API/status/update coordination inside a dedicated Kubernetes namespace independent of the Alga PSA application namespace.
- Preserve the existing user-facing setup flow: setup URL/token, channel/release selection, hostname/DNS options, initial tenant/admin inputs, progress/status UI, and retryable failures.
- Keep a tiny host fallback for emergency recovery: reapply the baked control plane and collect basic host diagnostics.
- Target new installs only. Do not migrate already-installed appliances in this phase.

## Non-goals

- No live migration from host-based setup to Kubernetes-hosted setup for existing appliances.
- No OS package manager or deb repository for setup updates in this phase.
- No full host OS/k3s upgrade system.
- No dependency on Flux or external network before the first setup UI is available.
- No redesign of the Alga PSA application Helm chart beyond what is needed for clean handoff from the control plane.

## Users and Primary Flows

### Appliance installer / MSP operator

1. Boots the ISO and installs the appliance.
2. Sees the console banner with setup URL and token.
3. Opens the setup UI served by the Kubernetes-hosted control plane.
4. Enters hostname/DNS/channel and initial tenant/admin details.
5. Watches progress through storage, Flux/release source, application bootstrap, migrations/seeds, and login readiness.
6. Opens the Alga PSA login URL when ready.

### Support engineer

1. Uses a host fallback command if the setup control plane is not responding.
2. Reapplies the baked control-plane bundle from disk.
3. Uses the setup/status UI or diagnostics endpoint to collect support details once the control plane is running.

## UX / UI Notes

- The setup/status UI should remain visually consistent with the current `ee/appliance/status-ui` experience.
- The setup URL/token behavior should remain familiar.
- During host bootstrap, the console should clearly distinguish:
  - k3s substrate starting,
  - control plane applying,
  - setup UI available,
  - fallback command if the setup UI does not appear.
- The control plane should report whether it is running from the baked ISO bundle or from a later updated release.

## Requirements

### Functional Requirements

1. The ISO includes a baked appliance control-plane bundle containing:
   - setup/status UI static assets or image,
   - setup/status API image or manifests,
   - required Kubernetes manifests/Helm chart,
   - local-path storage manifest,
   - image archive(s) needed for offline startup.
2. Host bootstrap installs/starts k3s with minimal options and waits for the Kubernetes API.
3. Host bootstrap imports the baked control-plane image archive(s) into k3s/containerd before applying manifests.
4. Host bootstrap applies storage and the control-plane namespace/workloads from local disk.
5. The setup UI is reachable on the same expected appliance host port, currently `:8080`, without requiring external network access.
6. The control plane can execute the existing setup workflow or equivalent:
   - validate setup inputs,
   - persist release/runtime selection,
   - configure Flux source,
   - configure application runtime values,
   - create the initial tenant/admin secret,
   - trigger application bootstrap,
   - report status and blockers.
7. The control plane remains independent of Alga PSA app readiness, so app failures do not take down setup/status.
8. A host fallback command can reapply the baked control plane from local disk.
9. New-install docs and console output explain the new bootstrap layers.

### Non-functional Requirements

- First setup UI must be available without GitHub, DNS, or registry access, assuming k3s starts locally.
- Host bootstrap scripts should be small and mostly idempotent.
- Control-plane manifests should be safe to reapply.
- Status should be resilient to partially installed or failed application components.
- The design should minimize moving parts before the setup UI is available.

## Data / API / Integrations

- Reuse or adapt current host-service API contracts where practical:
  - `/api/status`
  - setup submission endpoint(s)
  - update/status metadata endpoints
- Persist setup state in Kubernetes resources where appropriate, while retaining any host files needed for fallback/recovery.
- Continue producing the Helm values/Secrets needed by `alga-core` bootstrap, including the initial tenant/admin secret.
- Continue using Flux for application release reconciliation after the control plane is available.

## Security / Permissions

- The setup token remains required for setup/status access until the appliance is ready.
- Control-plane service account permissions should be scoped to appliance setup operations, not broad cluster-admin unless unavoidable for v1.
- Initial admin password and tenant setup data must be stored only in Kubernetes Secrets or equivalent protected storage.
- Host fallback commands should require local shell/sudo access.
- Bundled image/manifests should be traceable to a build version; signature verification can be considered for follow-up if not included in v1.

## Observability

- Control plane exposes status equivalent to the current setup/status UI.
- Host bootstrap logs clearly record k3s install, image import, manifest apply, and setup URL availability.
- Support bundle collection should include host bootstrap logs, control-plane pod logs, relevant Kubernetes resources, and application bootstrap resources.

## Rollout / Migration

- New installs only.
- Existing host-based setup remains unchanged for already-installed appliances in this phase.
- ISO build process must stage the baked control-plane bundle and image archive(s).
- Release metadata may need to advertise the preferred control-plane version for future updates, but first boot must use the baked local bundle.

## Open Questions

- Should the control plane be delivered as a single combined setup-api image serving static UI assets, or as separate UI/API containers?
- Should ingress/exposure use hostNetwork, NodePort, or a minimal in-cluster proxy/ServiceLB replacement for port `8080`?
- Which setup state must remain on the host for fallback versus moving fully into Kubernetes?
- Do we include cryptographic signature verification for the baked bundle in v1, or defer it to online control-plane updates?

## Acceptance Criteria (Definition of Done)

- A fresh Ubuntu/k3s appliance ISO install reaches the setup UI with no external network dependency beyond the local machine/browser.
- The setup UI/API run in Kubernetes, not as the primary host systemd setup service.
- Host bootstrap is limited to k3s substrate setup, baked image import, local storage/control-plane manifest apply, and fallback tooling.
- The setup flow creates the initial tenant/admin and reaches login-ready on a fresh install.
- Reapplying the baked control plane from the host succeeds and does not destroy application data.
- Status UI remains available when Alga PSA app bootstrap is blocked or unhealthy.
- Targeted automated tests and one fresh-install smoke test validate the new bootstrap path.
