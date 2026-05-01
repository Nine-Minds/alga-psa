# Appliance Bootstrap TUI and Standalone Status UI Design

## Goals

- Keep the early appliance status page available at `http://<node-ip>:8080` before the main Alga application image is pulled or login is ready.
- Show failed bootstrap job log output directly to the installing admin, including actionable application errors such as missing seed directories.
- Change the bootstrap operator experience from sequential terminal output to a TUI layout with a persistent status pane and a scrolling install log.
- Move the richer status page toward a maintainable standalone Next.js UI that visually aligns with the Alga application tokens in `server/src/app/globals.css`.

## Security posture

The status UI remains token-protected. Bootstrap prints and stores the token for the local installing admin. Because this surface is explicitly an admin install tool, bootstrap logs are admin-visible and are not redacted by default. A future support-bundle sharing flow may add a separate redacted export mode.

## Architecture

The status plane remains separate from the main Alga app. The `appliance-status` workload owns port `8080`, reads Kubernetes/Flux/Helm state directly, and serves status APIs even while core application pods are still pulling images or failing bootstrap.

The first implementation step keeps the existing small Node status service so the running appliance can be fixed immediately. It adds `pods/log` access and exposes failed bootstrap log excerpts in the canonical status schema. In parallel, a standalone `ee/appliance/status-ui` Next.js app is introduced as the long-term UI source. The status pod/image can later serve the exported Next assets instead of the inline fallback page.

## Status schema additions

`/api/status` includes:

```json
{
  "bootstrap": {
    "job": { "name": "alga-core-sebastian-bootstrap-r7", "state": "failed", "failed": true },
    "logs": {
      "available": true,
      "pod": "alga-core-sebastian-bootstrap-r7-5lh7j",
      "container": "bootstrap",
      "tail": ["..."],
      "detectedErrors": ["ERROR: Configured seed directory does not exist: /app/ee/server/seeds/onboarding"]
    }
  }
}
```

When a bootstrap job fails, the first actionable log error is promoted ahead of generic Flux blockers. The rollup message should say what the admin can act on, for example:

```text
Bootstrap failed: ERROR: Configured seed directory does not exist: /app/ee/server/seeds/onboarding
```

## Bootstrap TUI

The existing Ink operator TUI is the UI layer. The shell bootstrap script remains automation-friendly and continues to be the lifecycle engine.

During a running bootstrap, the TUI uses a two-pane layout:

1. Persistent top pane:
   - status page URL
   - login URL
   - install state
   - current operation
   - current blocker/root cause when known
2. Scrolling lower pane:
   - live `bootstrap-appliance.sh` output
   - phase markers
   - failure line(s)

The TUI refreshes canonical status while the lifecycle script runs so the top pane can change from image pulling, to bootstrap running, to failed/ready without losing the live log stream.

## Standalone Next.js status UI

`ee/appliance/status-ui` is a small Next.js app that fetches `/api/status` from the same origin and renders:

- overview and next action
- current operation/image pull details
- readiness tier cards
- top blockers
- bootstrap log excerpt and detected errors
- recent Kubernetes/Flux events

The CSS uses Alga-style tokens, matching the semantics from `server/src/app/globals.css` while avoiding a dependency on the main app runtime.

## Deployment path

Short term: the existing Node status service continues to serve an inline fallback page with the same data and style direction.

Long term: package a small `appliance-status` image containing the status API and exported Next.js assets. This avoids storing a large UI bundle in Kubernetes ConfigMaps and keeps the `:8080` early-status guarantee.
