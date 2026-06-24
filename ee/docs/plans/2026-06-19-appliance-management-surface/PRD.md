# PRD — Appliance post-install Management surface

Date: 2026-06-19
Plan: `ee/docs/plans/2026-06-19-appliance-management-surface/`
Design: `./design.md`

## Problem statement and user value

Once an Alga appliance is installed there is no place to run ongoing operations. App updates exist only at an unlinked server-rendered `/updates` page. Control-plane upgrades happen only on reboot. The "Setup" sidebar button is dead post-install (the host-service 303-redirects `/setup` to `/` once `mode=status`). Applying a license has no home at all — a license is set only during setup, so an airgap operator with a renewed or upgraded license is stuck.

This delivers a single **Manage** surface in the appliance status UI where an operator can update the app, upgrade the control plane, apply a license, and correct the app URL/DNS — without a host shell or a reboot.

## Goals

- Repurpose the dead Setup sidebar entry into an in-SPA **Manage** area with sub-tabs: Updates, Control-plane, License, Settings.
- Let an operator trigger an **app-channel update** from the UI (within the installed channel) and watch it complete.
- Let an operator trigger a **control-plane upgrade** from the UI, executed by the host-agent so it survives the pod replacing itself.
- Let an airgap operator **apply a new license JWS** and see current edition/expiry.
- Let an operator **edit the app URL/hostname and DNS** so `NEXTAUTH_URL` follows, fixing the `alga.local` class of problem in-product.
- Fix the prerequisite kubeconfig bug so app updates actually complete from the pod.

## Non-goals (v1)

- Channel switching (stable↔nightly) from the UI — updates run within the installed channel.
- Install-code re-redemption / tenant re-binding from the UI.
- Automatic control-plane rollback (the host-side `alga-control-plane-reapply` CLI remains recovery).
- OS / k3s updates (remain manual / support-run).
- Re-running the full setup workflow post-install.
- Metrics, audit logging, and other operational hardening unless requested.

## Target users and primary flows

**Persona:** the appliance operator (MSP admin) managing an installed on-prem appliance via the status UI, authenticated with the host-service management password.

Primary flows:

1. **Update the app.** Manage → Updates shows current version; operator clicks Update; UI shows progress and confirms completion (or a clear blocked reason).
2. **Upgrade the control plane.** Manage → Control-plane shows "up to date" or "upgrade available"; operator confirms; UI shows "upgrading, reconnecting…", the new control-plane pod comes up, UI confirms the new digest.
3. **Apply a license.** Manage → License shows current edition/expiry; operator pastes a new license JWS; UI validates, applies, and the app restarts onto the new license.
4. **Fix the app URL.** Manage → Settings shows the current app URL/DNS; operator edits the hostname; UI applies and the app restarts with the corrected `NEXTAUTH_URL`.

## UX/UI notes

- Manage is an in-SPA section (not a `/setup` navigation), reached from the renamed sidebar entry. Sub-tabs mirror the existing tab styling.
- Each mutating action shows a confirmation step (it causes a restart / brief downtime) and an in-progress/result state.
- Control-plane upgrade explicitly handles the served-by-the-thing-being-upgraded case: a "reconnecting…" state that polls health and resolves to success or a recovery hint (`alga-control-plane-reapply`).
- "Up to date" vs "upgrade available" is shown for both app and control plane (version/digest compare), so buttons aren't blind.

## Data model / API integration notes

New/used host-service endpoints (all behind `requireAuth`):

- `GET  /api/manage/status` — aggregate: app version + channel, running control-plane digest vs. resolved channel `controlPlane` digest, edition + license expiry, current app URL/DNS.
- `POST /api/updates` — existing; surfaced. App-channel update within installed channel.
- `POST /api/control-plane/upgrade` — new; forwards to host-agent `POST /v1/control-plane/upgrade`; returns 202.
- `POST /api/license/apply` — new; validate airgap license JWS, update `appliance-license-seed` secret, `rollout restart` app.
- `POST /api/settings/app-url` — new; rewrite `appUrl`/`host`/`domainSuffix` in `alga-core` values, persist `release-selection.json` `runtime.appHostname`/DNS, reconcile the `alga-core` HelmRelease.

Host-agent: add `POST /v1/control-plane/upgrade` that runs the bootstrap control-plane apply (resolve channel `controlPlane` digest → `ctr` pull → `kubectl apply -k` overlay), reusing `bootstrap-control-plane.sh` logic / `resolve-control-plane-image.mjs`.

Prerequisite: `reconcileFluxAndHelm` (`update-engine.mjs`) must honor `ALGA_APPLIANCE_KUBECONFIG` / in-cluster config instead of the hardcoded `/etc/rancher/k3s/k3s.yaml`.

State touched: k8s configmap `appliance-values-alga-core` (alga-system), secret `appliance-license-seed`, host files `release-selection.json` (`/var/lib/alga-appliance`), the `alga-core` HelmRelease, and the `appliance-control-plane` Deployment. No app Postgres schema changes.

## Risks, rollout, open questions

- **Self-replacing control plane.** The upgrade runs in the host-agent (root, on host) so it survives the pod Recreate; the UI must tolerate the dropped connection. Risk: a bad control-plane image leaves a broken UI — mitigated by the digest pre-pull + the `alga-control-plane-reapply` recovery path (documented in the failure state), not auto-rollback in v1.
- **kubeconfig fix blast radius.** Changing the reconcile kubeconfig affects the existing update path; covered by host-service tests + live smoke.
- **Airgap JWS validation depth.** v1 validates format + applies; it does not verify the signature in-product (the app validates the license at runtime). Acceptable for v1; note it.
- Rollout: single bundled feature PR; validate on the libvirt VM end to end before merge.

## Acceptance criteria / definition of done

- Sidebar shows **Manage** (not a dead Setup link); clicking it opens the in-SPA Manage area with the four sub-tabs; no `/setup` 303 involved post-install.
- From Updates, an app update **completes** end to end on the VM (kubeconfig fix in place) and the UI reflects status.
- From Control-plane, an upgrade swaps the running digest and the UI reconnects and confirms; "up to date" is shown when current.
- From License, applying a valid airgap JWS updates the seed and the app restarts onto it; an invalid JWS is rejected with a clear message; current edition/expiry is shown.
- From Settings, editing the app hostname propagates to `NEXTAUTH_URL` and the app restarts; sign-in works at the configured URL.
- All mutating endpoints require auth; each action has a confirmation and a result/failure state.
- Host-service tests pass; live VM smoke validates each of the four actions.
