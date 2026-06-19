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
