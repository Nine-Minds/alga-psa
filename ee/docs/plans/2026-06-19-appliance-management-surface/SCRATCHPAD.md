# SCRATCHPAD — Appliance post-install Management surface

Working memory for this effort. Append freely; curate as decisions change.

## Status
- 2026-06-19: brainstorm complete + approved. Design committed at `design.md`. Building PRD/features/tests.
- Branch: `feature/appliance-management-surface` (worktree `~/alga-psa.worktrees/appliance-management-surface`), off `main` @ d42dab4f06.

## Key decisions (from brainstorm)
- Repurpose the dead **Setup** sidebar entry → in-SPA **Manage** section (sub-tabs: Updates · Control-plane · License · Settings). Do NOT fight the `/setup` 303 — Manage is in-SPA nav, the `/setup` wizard route stays pre-install only.
- Control-plane upgrade runs via the **host-agent** (root, on host) — proven bootstrap apply, NOT reboot, NOT in-pod self-replace.
- License = apply/replace an **airgap license JWS** + show status.
- Settings = **app URL/hostname + DNS** only.

## Anchor facts / file map (verified this session)
- status-ui: Next.js static export (`output: 'export'`), served by control-plane pod at `/`. Sidebar tabs at `ee/appliance/status-ui/app/page.tsx:254-258` (Overview/Deployments/Pods/Logs); dead Setup link `<a href="/setup/">` at ~`:667`; behind `AuthGate` (layout.tsx).
- host-service `/api/updates` → `runAppChannelUpdate` (`update-engine.mjs`); app-channel only (`scope: 'application-only'`). Auth via session cookie (`isAuthenticated`/`requireAuth`, `auth.mjs`).
- **host-agent** = tiny root HTTP server over `/run/alga-appliance/host-agent.sock` (`host-agent.mjs`); today only `GET /v1/health` + `POST /v1/support-bundle`. Runs as root (systemd `alga-host-agent.service`). The pod reaches it via the mounted socket (`ALGA_APPLIANCE_HOST_AGENT_SOCKET`). → add `POST /v1/control-plane/upgrade`.
- Control-plane image is **digest-pinned** by `bootstrap-control-plane.sh apply_control_plane()`: `resolve-control-plane-image.mjs` does a LIVE `GET ghcr.io/.../alga-appliance-release:<channel>` (channel from `release-selection.json selectedChannel`), reads `manifest.controlPlane` (repo@sha256:…), `ctr pull`s it, applies kustomize overlay (`newName`+`digest`). Reboot re-runs this; offline → falls back to baked `localhost/...:baked`.
- Licensing today set ONLY at setup: airgap `licenseKey` (JWS, format check at `server.mjs:~710`) or `installCode` redeemed → `appliance-license-seed` secret. Connected installs auto-refresh via daily check-in; airgap has no post-install path.
- App URL: `appUrl`/`host`/`domainSuffix` in `alga-core` values configmap → Helm renders `NEXTAUTH_URL`/`NEXT_PUBLIC_BASE_URL` (`helm/templates/deployment.yaml:560-569`). Setup writes the hostname override in `applyRuntimeValuesAndReleaseSelection` (`setup-engine.mjs:968-973`).

## Gotchas
- **kubeconfig bug (prereq):** `reconcileFluxAndHelm` (`update-engine.mjs`) hardcodes `--kubeconfig /etc/rancher/k3s/k3s.yaml`, NOT mounted in the pod → `/api/updates` dies at flux reconcile (`stat /etc/rancher/k3s/k3s.yaml: no such file`) AFTER app URL is preserved. Must honor `ALGA_APPLIANCE_KUBECONFIG` / in-cluster config for Updates to actually complete. (In-pod kubectl for the configmap apply already works via the SA, so only the flux/helm reconcile path is broken.)
- **Just merged PR #2731** (squashed to main @ d42dab4f06): fixes the release-selection `/etc`→`/var/lib` path default + no-silent-downgrade guard. This plan builds on it.
- Control-plane deployment can be repointed to a ghcr digest; the `localhost/...:baked` tag won't auto-update (tag + IfNotPresent). CP channel update is digest-based, so a new release = new digest = pulled (no stale-skip).
- Testbed VM: libvirt `ubuntu24.04`, DHCP (was .55, seen .215). Drive via algadev IDE panes (this harness kills hosted servers w/ exit 144; serve transfers from a real IDE terminal). See memory [[appliance-control-plane-hotfix-deploy]], [[appliance-update-appurl-reset]].

## Commands / runbook
- Build control-plane: rsync `ee/appliance` → `$HOME/cp-build`, `docker build --provenance=false -f ee/appliance/control-plane/Dockerfile -t localhost/alga-appliance-control-plane:baked .`; `ctr images import`; if deploy is pinned to a ghcr digest, `kubectl -n alga-appliance-control-plane patch deploy appliance-control-plane` both init+main container → localhost:baked.
- Apply a corrected alga-core configmap: `kubectl -n alga-system annotate helmrelease alga-core reconcile.fluxcd.io/requestedAt=$(date +%s) --overwrite`.

## Open questions (for PRD convergence)
- PR/sequencing: kubeconfig fix as standalone PR first, or bundled?
- Updates: allow channel switch (stable↔nightly) or trigger-within-current-channel only?
- License status source/depth for v1.

## Live validation (2026-06-19, VM 192.168.122.215)
All five flows validated on the libvirt VM with the worktree control-plane image deployed:
- GET /api/manage/status → real data (license edition ee, appUrl http://192.168.122.215:3000, CP resolvedDigest sha256:dc3d188…). runningDigest null on this VM because it runs the local `:baked` tag (not a channel digest) — compare logic is unit-tested.
- Settings: POST /api/settings/app-url rewrote the alga-core configmap appUrl, persisted release-selection runtime.appHostname, reconciled the HelmRelease. {ok:true}.
- License: POST /api/license/apply patched appliance-license-seed LICENSE_TOKEN (decoded == sent JWS) + rolled the app. {ok:true}.
- Updates: POST /api/updates → 202; install-state reached **update-complete** ("App-channel update applied for stable") — proves the kubeconfig + helmcharts-RBAC prereq fix (was broken at the flux reconcile step before).
- Manage UI: logged into :8080, sidebar shows **Manage** (was the dead Setup link), opens the in-SPA Manage view with Updates/Control-plane/License/Settings; live status rendered.
- Control-plane upgrade: host-agent alive with /v1/control-plane/upgrade route; `bootstrap-control-plane.sh --control-plane-only --dry-run` plans only wait→apply (skips k3s/import/storage). Full swap is the proven reboot apply_control_plane path (not run, to keep the test build deployed).

## Deploy procedure (TWO targets — important)
1. Pod image (server.mjs, update-engine, status-ui, manage-engine): rebuild control-plane image, ctr import, `rollout restart` (deploy already pinned to localhost:baked). Has the Manage backend + UI.
2. HOST files (host-agent.mjs, bootstrap-control-plane.sh run on the host, NOT the pod): copy to /opt/alga-appliance/{host-service,scripts}/ and `systemctl restart alga-host-agent.service`.
3. RBAC: `kubectl apply -f control-plane/manifests/rbac.yaml` (helmcharts addition).
Test management password on the VM was reset to `Manage.Test99` during validation (alga-appliance-reset-admin). Set the password via curl from the workstation Bash tool, NOT the interactive pane — `!` in the password gets history-expanded by the pane's interactive bash and corrupts it.
