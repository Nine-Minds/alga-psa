# Appliance post-install Management surface — design

Date: 2026-06-19
Status: approved (brainstorm), pending implementation plan
Area: `ee/appliance` host-service + status-ui + host-agent

## Problem

After an appliance is installed there is no place to run ongoing operations:

1. **App updates** exist only at the server-rendered `/updates` page, which is not linked from anywhere. Operators cannot discover or trigger an app-channel update from the UI.
2. **Control-plane upgrades** can only happen on reboot — `bootstrap-control-plane.sh` re-resolves the channel's `controlPlane` digest and applies it at boot. There is no self-service trigger.
3. **The "Setup" sidebar button is dead post-install.** Once setup completes (`mode=status`), the host-service 303-redirects `/setup` back to `/` (`server.mjs`), so clicking Setup bounces to the status page.
4. **Applying a license has no home.** A license is set only at setup (airgap license JWS, or an install code redeemed against `alga-license`). Connected installs auto-refresh via a daily check-in; airgap installs have no post-install path to apply a renewed or upgraded license.

## Goal

A single post-install **Manage** surface in the status UI that hosts the operations an operator needs after install: app updates, control-plane upgrades, license application, and safe settings re-edits. Reuse the proven mechanisms (the app-channel update flow, the bootstrap control-plane apply, the license-seed secret) rather than inventing new ones.

## Decisions (from brainstorm)

- Repurpose the **Setup** sidebar entry into a **Manage** area inside the React status UI.
- Control-plane upgrades execute via the **host-agent** (root, on the host), not in-pod and not via reboot.
- License section applies/replaces an **airgap license key** and shows current status.
- Settings section edits **app URL/hostname + DNS only**.

## 1. Surface and routing

The status UI is a Next.js static export (`output: 'export'`) served by the control-plane pod at `/`. It is a single-page app with sidebar tabs (Overview, Deployments, Pods, Logs) plus the dead Setup link and Logout.

- Rename the sidebar **Setup → Manage**. Change it from `<a href="/setup/">` to an **in-SPA section switch**, like the other tabs. Because Manage is part of the already-loaded SPA, there is no navigation to `/setup/` and therefore no 303 to fight.
- The Manage section has sub-tabs: **Updates · Control-plane · License · Settings**.
- `/setup/` (the install wizard route) is unchanged and serves pre-install only (`mode=setup`). Its 303 guard stays as a harmless backstop; nobody navigates there post-install.
- Manage sits behind the existing `AuthGate` (host-service session cookie). Every mutating endpoint calls `requireAuth`.

Rejected alternative: literally repurposing `/setup` to render Manage post-install. It works but fights the server redirect and forces a page reload. In-SPA navigation is cleaner and the operator experience is identical.

## 2. Sections and endpoints

| Section | Operator action | Backing |
|---|---|---|
| **Updates** | Show current app version + channel; trigger an app-channel update (`stable`/`nightly`); poll `update-running → update-complete/update-blocked`. | Existing `POST /api/updates` → `runAppChannelUpdate`. Requires the kubeconfig prerequisite (§4). |
| **Control-plane** | Show running control-plane digest vs. the channel's resolved `controlPlane` digest ("upgrade available?"); trigger the upgrade; show "upgrading, reconnecting…". | New `POST /api/control-plane/upgrade` → host-agent (§3). |
| **License** | Show edition + license status/expiry; paste a new airgap license JWS to apply. | New `POST /api/license/apply`: validate the JWS format (reuse the check in `server.mjs`), update the `appliance-license-seed` secret, `rollout restart` the app to pick it up. |
| **Settings** | Edit app URL/hostname + DNS. | New `POST /api/settings/app-url`: rewrite `appUrl`/`host`/`domainSuffix` in the `alga-core` values, persist `release-selection.json` `runtime.appHostname`/DNS, reconcile the `alga-core` HelmRelease so `NEXTAUTH_URL` follows. This is the hostname-override slice of `applyRuntimeValuesAndReleaseSelection`, extracted as a targeted operation. |

## 3. Control-plane upgrade flow

The control-plane pod serves the Manage UI, so it cannot cleanly upgrade itself in-process — the request that triggers the upgrade is killed when its own pod is replaced (`Recreate`). The host-agent solves this: it runs on the host as root and is reachable from the pod over `/run/alga-appliance/host-agent.sock` (today it serves `GET /v1/health` and `POST /v1/support-bundle`).

```
Manage UI ── POST /api/control-plane/upgrade ──▶ host-service (in pod)
                                                   │ forwards over the socket
                                                   ▼
                              host-agent (root, on host)  POST /v1/control-plane/upgrade
                                                   │
                  runs the proven bootstrap apply (NOT a reboot):
                  resolve channel controlPlane digest → ctr pull → kubectl apply -k overlay
                                                   │
                                          Deployment Recreate ──▶ new control-plane pod
```

- The host-service returns **202 immediately** (fire-and-forget). The host-agent drives the swap, so the work survives the pod being replaced.
- The UI detects the dropped connection, shows **"upgrading, reconnecting…"**, and polls `/v1/health` / `/api/status` until the new pod answers, then confirms the new digest.
- "Upgrade available" is a digest compare (the resolved channel `controlPlane` vs. the running pod's `imageID`). The button is a no-op / disabled when already current.

## 4. Prerequisite and safety

- **Prerequisite — kubeconfig fix.** `reconcileFluxAndHelm` in `update-engine.mjs` hardcodes `--kubeconfig /etc/rancher/k3s/k3s.yaml`, which is not mounted in the control-plane pod. So `POST /api/updates` currently fails at the flux-reconcile step (after the app URL is already preserved). Making Updates a real button requires honoring the in-pod kubeconfig (`ALGA_APPLIANCE_KUBECONFIG` / in-cluster config). This is in scope.
- **Confirmations** on Updates, Control-plane, and License-apply — all cause restarts or brief downtime.
- **No automatic rollback in v1.** The host-side `alga-control-plane-reapply` CLI remains the recovery path for a bad control plane; the UI surfaces it in the failure state.
- **Auth** on every mutating route. **Idempotent** "already current" handling on updates/upgrades.

## 5. Testing

Light automated coverage plus live validation, matching the appliance host-service convention:

- Host-service engine/route unit tests for the new endpoints and the new host-agent route, in the style of the existing `*-engine.test.mjs` / `*-state-paths.test.mjs` suites.
- Live smoke on the libvirt VM for each action: app update completes end to end (with the kubeconfig fix), control-plane upgrade swaps the digest and the UI reconnects, license apply, and app-URL edit propagates to `NEXTAUTH_URL`.

## Out of scope (v1)

- Install-code re-redemption / tenant re-binding from the UI.
- Automatic control-plane rollback.
- OS / k3s updates (remain manual / support-run).
- Re-running the full setup workflow post-install.
