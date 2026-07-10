# Scratchpad — Appliance pod access

- Plan slug: `appliance-pod-access`
- Created: `2026-07-10`

## Decisions

- (2026-07-10) Use `@kubernetes/client-node` for exec and port-forward streams.
  This provides native terminal-resize handling and avoids local PTY subprocess
  supervision.
- (2026-07-10) Use `@xterm/xterm` in the browser and `ws` for the host-service
  WebSocket endpoint.
- (2026-07-10) Existing management-session authentication is sufficient. Do not
  add password step-up authentication.
- (2026-07-10) Port forwards bind to the appliance LAN address and are
  unauthenticated after creation. The UI must keep that exposure visible.
- (2026-07-10) Terminal sessions end on disconnect or 30 minutes idle. Port
  forwards default to 30 minutes and may extend to 8 hours.
- (2026-07-10) Auto shell selection tries bash before sh and keeps explicit Auto,
  bash, and sh choices.
- (2026-07-10) Keep automated testing minimal. Cover the privileged boundaries
  and production builds, then perform full live smoke testing separately.
- (2026-07-10) Keep pod-access state in the control-plane process. A restart
  intentionally closes terminals, listeners, and accepted connections.

## Discoveries / Constraints

- (2026-07-10) `ee/appliance/status-ui/app/page.tsx` already contains namespace,
  pod, and container selection for logs. The Access tab can reuse that data flow.
- (2026-07-10) `ee/appliance/host-service/server.mjs` uses a plain Node HTTP
  server and signed cookie auth. It can own the WebSocket upgrade path.
- (2026-07-10) `ee/appliance/host-service/kubectl-queue.mjs` is a bounded serial
  command queue and is unsuitable for long-running interactive streams.
- (2026-07-10) The control-plane pod uses `hostNetwork`, so a Node TCP listener
  can bind directly to the appliance LAN address.
- (2026-07-10) The current ClusterRole grants pod access but not the exact
  `pods/exec` and `pods/portforward` subresources.
- (2026-07-10) Control-plane image promotion does not update the RBAC manifests
  installed on the host from the ISO. Existing appliances need a narrow startup
  migration for the two subresource rules.
- (2026-07-10) The official Kubernetes JavaScript exec client supports a
  terminal-size queue when the output stream is resizable.
- (2026-07-10) The working copy is
  `/home/robert/alga-copies/feature-appliance-pod-access` on branch
  `feature/appliance-pod-access`.
- (2026-07-10) The native client is packaged under
  `/opt/alga-appliance/host-service/node_modules` so ESM resolution works from
  the copied host-service modules without adding appliance dependencies to the
  repository root.
- (2026-07-10) `req.socket.localAddress` identifies the exact appliance address
  used for the management request. The port-forward manager binds that address
  instead of `0.0.0.0`.
- (2026-07-10) Plain HTTP appliance origins may not expose the Clipboard API.
  The address-copy action includes a DOM copy fallback.

## Commands / Runbooks

- Build the status UI: `npm --prefix ee/appliance/status-ui run build`.
- Run host-service tests: `node --test ee/appliance/host-service/tests/*.test.mjs`.
- Publish the control plane with
  `WorkflowTemplate/alga-appliance-control-plane-build-publish` in namespace
  `argo` after the implementation commit is available remotely.
- Focused checks:
  `node --test ee/appliance/host-service/tests/pod-access.test.mjs ee/appliance/host-service/tests/control-plane-manifests.test.mjs ee/appliance/host-service/tests/control-plane-package.test.mjs ee/appliance/host-service/tests/status-ui-package-smoke.test.mjs`.
- Full host-service regression suite:
  `node --test ee/appliance/host-service/tests/*.test.mjs` (89 tests passed).
- Production image build:
  `docker build --progress=plain --provenance=false -f ee/appliance/control-plane/Dockerfile -t alga-appliance-control-plane:pod-access .`.

## Links / References

- Design: `docs/plans/2026-07-10-appliance-pod-access-design.md`
- Status UI: `ee/appliance/status-ui/app/page.tsx`
- Host service: `ee/appliance/host-service/server.mjs`
- Authentication: `ee/appliance/host-service/auth.mjs`
- Control-plane RBAC: `ee/appliance/control-plane/manifests/rbac.yaml`
- Control-plane image: `ee/appliance/control-plane/Dockerfile`
- Kubernetes JavaScript client: `https://github.com/kubernetes-client/javascript`
- xterm.js: `https://github.com/xtermjs/xterm.js`

## Open Questions

- None. Live shell and LAN port-forward behavior remains for the agreed smoke
  test pass after merge.
