# PRD — Appliance Operator TUI

- Slug: `appliance-operator-tui`
- Date: `2026-03-25`
- Status: Draft

## Summary
Build a terminal-first appliance operator UI under `ee/appliance` so operators can bootstrap, upgrade, reset, and inspect a Talos-based Alga PSA appliance without remembering `talosctl`, `kubectl`, config paths, or appliance script arguments.

The first version should wrap the existing appliance scripts and cluster objects rather than replacing them. The TUI should become the preferred operator entrypoint for appliance lifecycle actions while preserving the current script-based automation under the hood.

## Problem
The current Talos appliance workflow is operationally dense:

- bootstrap requires long shell commands and accurate path management
- upgrade and reset require knowing which script to invoke and which kubeconfig to point at
- status checks require direct `kubectl` and `talosctl` knowledge
- operators have to remember where persistent config lives under `~/nm-kube-config/...`
- the current flow is hard to teach, hard to support, and easy to misuse

This is acceptable for engineering iteration but not for a user-friendly appliance experience.

## Goals
- Provide one supported terminal-first entrypoint for appliance lifecycle operations.
- Hide direct `kubectl` and `talosctl` usage from normal operators.
- Make bootstrap, upgrade, reset, and status accessible through guided flows.
- Reuse the current release manifest model and existing appliance shell scripts.
- Centralize appliance environment discovery so operators do not need to know config file locations.
- Prepare the design so the same operator core can later be packaged as a standalone tool outside the repo.

## Non-goals
- Replace Flux, Helm, or Talos with a new control plane.
- Build a web-based operator console in v1.
- Add new appliance lifecycle operations beyond bootstrap, upgrade, reset, status, and support-bundle adjacency.
- Re-architect the underlying appliance release model, Flux layout, or shell scripts as part of this work.
- Eliminate the script entrypoints; they remain supported internals.

## Users and Primary Flows
Primary users:

- Alga engineers operating test or customer appliances
- customer-side operators performing guided installs or upgrades
- support engineers diagnosing appliance state without teaching raw cluster commands

Primary flows:

1. **Bootstrap / initial install**
   - operator launches the TUI
   - selects bootstrap
   - enters node IP, hostname, network settings, app URL, and release version
   - confirms destructive or first-boot actions
   - watches progress across Talos, storage, Flux, and app rollout
   - receives a clear completion or failure summary

2. **Upgrade**
   - operator launches the TUI
   - sees current installed release and available target releases
   - selects a target release version
   - confirms the upgrade
   - watches reconcile progress and final status

3. **Reset**
   - operator launches the TUI
   - selects reset
   - sees an explicit destructive warning
   - confirms the target appliance and reset scope
   - watches the reset complete and sees the post-reset state

4. **Status**
   - operator launches the TUI
   - sees the appliance summary without running raw commands
   - can identify whether the current blocker is Talos, Kubernetes, Flux, Helm, or a workload
   - sees the current release selection and public app URL
   - can identify the next recommended action

5. **Future standalone packaging compatibility**
   - the operator experience should not be tightly bound to repo-relative assumptions
   - business logic should work when the TUI is packaged with embedded manifests/scripts later

## UX / UI Notes
- The UI is terminal-first and menu-driven.
- The initial screen should focus on four clear actions:
  - `Bootstrap`
  - `Upgrade`
  - `Reset`
  - `Status`
- A persistent header should show:
  - selected appliance/site
  - node IP
  - current release version if known
  - current connectivity mode: Talos only, Kubernetes available, app healthy, or degraded
- Long-running actions should stream readable progress sections, not raw unfiltered command output.
- Destructive actions must show a clear confirmation screen with the exact target appliance and what will be wiped.
- Status should favor human-readable summaries over raw object dumps.
- The UI should expose config file paths on demand, but not require the user to know them up front.

## Requirements

### Functional Requirements
- The operator tool must live under `ee/appliance`.
- The tool must provide an interactive terminal UI entrypoint.
- The tool must provide a non-interactive command surface using the same operator core.
- The bootstrap flow must gather the current bootstrap inputs already required by `bootstrap-appliance.sh`.
- The bootstrap flow must invoke the existing bootstrap script rather than reimplementing Talos bootstrap logic.
- The upgrade flow must consume appliance release manifests and invoke the current upgrade behavior rather than asking for raw image tags.
- The reset flow must invoke the current reset helper and require strong confirmation.
- The status flow must collect and present:
  - Talos reachability and key health signals
  - Kubernetes node readiness
  - Flux `GitRepository`, `Kustomization`, and appliance `HelmRelease` state
  - PSA component status for `alga-core`, `db`, `redis`, `pgbouncer`, `temporal`, `workflow-worker`, `email-service`, and `temporal-worker`
  - selected appliance release and app URL
  - resolved config paths
- The tool must automatically discover the appliance config directory and avoid requiring the operator to type kubeconfig/talosconfig paths for common flows.
- The tool must present failure categories that help support identify whether the blocker is:
  - Talos host reachability
  - Kubernetes availability
  - Flux source/reconcile failure
  - Helm release failure
  - workload readiness failure
- The tool must keep direct `kubectl` and `talosctl` usage behind the scenes for normal operation.

### Non-functional Requirements
- The tool should remain lightweight and easy to distribute.
- The interactive path should remain usable over SSH and standard terminal environments.
- The implementation should be structured so repo-based use and future standalone packaging share the same operator core.
- The tool should favor deterministic, explicit flows over hidden mutation.
- The tool should reuse existing manifests and scripts to minimize divergence.

## Data / API / Integrations
- Inputs:
  - appliance release manifests under `ee/appliance/releases/<version>/release.json`
  - persistent config directories under `~/nm-kube-config/alga-psa/talos/...`
  - current shell scripts under `ee/appliance/scripts/`
- Runtime integrations:
  - `bootstrap-appliance.sh`
  - `upgrade-appliance.sh`
  - `reset-appliance-data.sh`
  - `collect-support-bundle.sh`
  - `talosctl`
  - `kubectl`
  - `flux` when available
- The TUI needs one internal status model that normalizes:
  - host status
  - cluster status
  - GitOps status
  - workload status
  - selected release metadata

Public operator command surface for v1 should be shaped around:

- `appliance tui`
- `appliance bootstrap`
- `appliance upgrade`
- `appliance reset`
- `appliance status`
- `appliance support-bundle`

## Security / Permissions
- The operator tool should not expose raw secrets in the interactive status view.
- Existing shell scripts remain responsible for secret creation and cluster mutation.
- The TUI must clearly signal when an action is destructive.
- The TUI must not broaden appliance privileges beyond the current script-based model.

## Observability
- The TUI should provide a concise state summary per layer:
  - Talos
  - Kubernetes
  - Flux
  - workloads
- Long-running operations should emit timestamped progress lines or stages.
- Failure screens should point operators to support-bundle collection as the next step when appropriate.

## Rollout / Migration
- Start by shipping the TUI as a repo-hosted appliance operator tool under `ee/appliance`.
- Keep the existing shell scripts intact and callable directly.
- Update appliance docs to make the TUI the preferred operator path and the scripts the advanced/fallback path.
- Preserve backward compatibility for the current release manifest and script contract.
- Defer standalone packaging to a later phase, but isolate path resolution and operator core logic now so that future packaging is straightforward.

## Open Questions
- Which TUI runtime/library should be used for the terminal-first implementation.
- Whether the initial status view should include recent pod logs/events or keep v1 strictly summary-only.
- Whether the non-interactive `appliance` commands should be introduced at the same time as the TUI, or immediately after the interactive path.

## Acceptance Criteria (Definition of Done)
- An operator can launch a terminal-first appliance UI from `ee/appliance` and select bootstrap, upgrade, reset, or status without manually invoking `kubectl` or `talosctl`.
- The bootstrap flow can gather required inputs and run the current appliance bootstrap end to end using the existing script path.
- The upgrade flow can show the current release and apply a selected release manifest version.
- The reset flow can execute the current reset helper with strong confirmation.
- The status flow can accurately summarize Talos, Kubernetes, Flux, and PSA component state for one appliance.
- The operator does not need to know the persistent kubeconfig/talosconfig file location for common flows.
- The implementation is organized so the operator core can later be packaged independently from the repo without rewriting lifecycle logic.
