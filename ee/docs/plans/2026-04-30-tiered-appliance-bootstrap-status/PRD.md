# PRD: Tiered Appliance Bootstrap Status

## Summary

Fresh on-premise appliance bootstrap currently feels opaque and overly fragile. A single long-running bootstrap can spend tens of minutes pulling large images, waiting on Helm timeouts, or hiding lower-level blockers behind generic `context deadline exceeded` messages. Non-login-critical services can also make the whole appliance appear unavailable even when the Alga core application is already usable.

Introduce a tiered appliance bootstrap model with an early token-protected status web UI. The appliance should clearly distinguish platform readiness, core business readiness, login readiness, background-service readiness, and full health. The first customer-visible milestone is **Ready to log in**, not “all optional/background services healthy.”

## Problem Statement

During a local Talos/UTM appliance bootstrap, the install took far longer than expected and required manual investigation. Time was spent on:

- Talos installer image pull blocked by DNS (`192.168.64.1:53` refused queries).
- A fresh reset helper failure (`target: unbound variable`).
- Large `alga-psa-ee` image pull taking roughly 16 minutes.
- `alga-core` Helm install waiting until a 30-minute timeout while Postgres was blocked by a PVC subPath error.
- Temporal Helm install timing out because the live deployment did not run autosetup.
- Temporal UI failing from Kubernetes service-link environment variable collision.
- Background worker releases blocked by missing image tags.

The operator had to inspect Talos console output, Kubernetes events, HelmRelease conditions, pod descriptions, and logs manually to understand whether the install was progressing, blocked, login-ready, or only background-degraded.

## Goals

1. Provide an early status web UI during bootstrap at a predictable node URL, protected by a generated token.
2. Define tiered readiness so `LOGIN_READY` is distinct from `FULLY_HEALTHY`.
3. Make the bootstrap CLI print the status URL/token and emit richer phase progress.
4. Split or organize appliance Flux/Helm rollout so background services do not block core login readiness.
5. Surface specific, actionable blockers instead of generic Helm timeouts.
6. Preserve a stable status data model that can later be backed by a controller/CRD without rewriting the UI.
7. Fold the concrete issues discovered during the local UTM/Talos bootstrap into durable chart/operator fixes.

## Non-goals

- Building a full replacement for Flux or Helm.
- Making every background service optional for all production deployments.
- Implementing a complete appliance management portal beyond bootstrap/status/support diagnostics.
- Exposing secret values or privileged Kubernetes mutation capabilities in the first status UI.
- Solving image publishing/release automation comprehensively beyond validating referenced tags before install.

## Users and Personas

### Customer/Admin Installer

Needs to know whether the appliance is installing, ready to log in, degraded, or requiring support. Should not need Kubernetes knowledge.

### Alga Support / Operator

Needs exact technical blockers, relevant events, component health, image pull failures, HelmRelease states, bootstrap job summaries, and support-bundle entry points.

### Developer / Release Engineer

Needs release validation feedback when a manifest references missing image tags or chart wiring causes predictable bootstrap failure.

## Primary User Flow

1. Admin starts appliance bootstrap.
2. CLI completes Talos/Kubernetes/platform prerequisites.
3. CLI installs the early `appliance-status` service.
4. CLI prints:

   ```text
   Appliance status UI:
     URL:   http://<node-ip>:8080
     Token: <generated-token>
   ```

5. Admin opens the status UI with the token.
6. Status page shows current phase and whether login is available.
7. Core Alga reaches `LOGIN_READY`; UI shows login URL.
8. Background services continue installing.
9. If background services fail, UI shows `Ready with background issues` and specific remediation guidance.

## Readiness Model

Readiness is tiered, not binary.

### PLATFORM_READY

Required:

- Talos node installed and booted from disk.
- Kubernetes API reachable.
- Node `Ready` and schedulable.
- CoreDNS healthy.
- DNS/outbound HTTPS checks pass.
- local-path storage installed.
- storage smoke test passes.
- Flux controllers running.
- `appliance-status` reachable.

### CORE_READY

Required:

- Postgres ready.
- Redis ready.
- PgBouncer ready if the app runtime uses PgBouncer.
- DB and Redis credentials exist.
- required PVCs bound.
- no login-critical pod in `CreateContainerConfigError`, `ImagePullBackOff`, or `CrashLoopBackOff`.

### BOOTSTRAP_READY

Required:

- bootstrap job completed.
- database exists.
- migrations completed.
- seed data exists.
- representative seed query passes, such as `server.users` count greater than zero.
- bootstrap mode is no longer destructive `fresh` semantics after successful first run.

### LOGIN_READY

Definition selected for this plan: **core business ready**.

Required:

- `CORE_READY`.
- `BOOTSTRAP_READY`.
- Alga web deployment ready.
- app URL responds.
- dashboard/login redirect works.
- public login URL known.

Not required:

- email service.
- Temporal.
- workflow worker.
- temporal worker.
- optional integrations.

### BACKGROUND_READY

Required background services healthy for the selected release/profile:

- email-service.
- Temporal and Temporal UI if enabled.
- workflow-worker.
- temporal-worker.
- future integration/background services.

### FULLY_HEALTHY

Required:

- `LOGIN_READY`.
- `BACKGROUND_READY`.
- all selected HelmReleases ready.
- no unacknowledged critical warnings.
- no missing image tags.
- no image drift.

## User-facing Rollup States

| State | Meaning |
|---|---|
| Installing | Platform/core/bootstrap/login not complete and no hard blocker yet. |
| Ready to log in | `LOGIN_READY=true`; background services may still be installing. |
| Ready with background issues | `LOGIN_READY=true`; at least one background component failed or is blocked. |
| Fully healthy | `FULLY_HEALTHY=true`. |
| Failed / action required | A platform/core/bootstrap/login blocker prevents use. |

## Proposed Architecture

### Early Status Service

Add a new early-installed chart or manifest set:

```text
appliance-status
```

Expose it on a predictable node URL:

```text
http://<node-ip>:8080
```

The service is token-protected. The bootstrap script/operator generates a token, stores it locally and in-cluster, and prints it to the admin.

Local path:

```text
~/.alga-psa-appliance/<site-id>/status-token
```

In-cluster Secret:

```text
namespace: appliance-system
secret: appliance-status-auth
key: token
```

The status service uses read-only Kubernetes RBAC and reads:

- Nodes.
- Pods.
- Jobs.
- PVCs.
- Events.
- Flux `GitRepository`.
- Flux `Kustomization`.
- Flux `HelmRelease`.
- selected ConfigMaps/Secrets metadata, not secret values.

### Hybrid Collector Model

First version may be a small web service that reads Kubernetes directly. Its internal status schema must remain clean and stable so a future controller can publish the same model via CRD or ConfigMap.

### UI Layers

#### Overview

Simple customer/admin status:

```text
Status: Ready to log in
Login URL: http://<node-ip>:3000
Background: 2 services need attention
Top issue: workflow-worker image tag not found
```

#### Advanced Diagnostics

Support/operator diagnostics:

- readiness tiers.
- component table.
- top blockers.
- recent Kubernetes events.
- HelmRelease conditions.
- image pull state.
- bootstrap job summary.
- support bundle action in a later milestone.

## Status API

Expose one canonical status document:

```text
GET /api/status
```

Representative shape:

```json
{
  "siteId": "appliance-single-node",
  "timestamp": "2026-04-30T02:08:10Z",
  "release": {
    "selectedReleaseVersion": "1.0-rc5",
    "appVersion": "1.0-rc5",
    "channel": "candidate",
    "gitRevision": "release/1.0-rc5@sha1:979e2079..."
  },
  "urls": {
    "statusUrl": "http://192.168.64.8:8080",
    "loginUrl": "http://192.168.64.8:3000"
  },
  "rollup": {
    "state": "ready_with_background_issues",
    "message": "Alga is ready to log in. Some background services need attention.",
    "nextAction": "Log in to Alga, then review background service issues."
  },
  "tiers": {
    "platform": { "ready": true, "status": "healthy" },
    "core": { "ready": true, "status": "healthy" },
    "bootstrap": { "ready": true, "status": "healthy" },
    "login": { "ready": true, "status": "healthy" },
    "background": { "ready": false, "status": "degraded" },
    "fullHealth": { "ready": false, "status": "degraded" }
  },
  "topBlockers": [
    {
      "severity": "background",
      "component": "workflow-worker",
      "layer": "image",
      "reason": "Image tag not found: ghcr.io/nine-minds/workflow-worker:61e4a00e",
      "nextAction": "Publish the missing image tag or update the appliance release manifest.",
      "loginBlocking": false
    }
  ]
}
```

## Blocker Detection Requirements

The collector must translate low-level conditions into actionable messages.

Examples from the observed bootstrap:

| Low-level signal | User-facing blocker |
|---|---|
| `lookup factory.talos.dev on 192.168.64.1:53: connection refused` | DNS resolver failure; configure explicit DNS servers and retry. |
| `failed to create subPath directory for volumeMount "db-data"` | Postgres PVC initialization failed; repair/recreate PVC subPath. |
| `ImagePullBackOff` and `not found` | image tag not found; publish missing tag or update release manifest. |
| `context canceled` during image pull | image pull interrupted; wait for retry or restart pod. |
| Helm install `context deadline exceeded` plus pod-level DB failure | report DB/PVC blocker, not generic Helm timeout. |
| Temporal `sql schema version compatibility check failed` | Temporal schema not initialized; verify autosetup or schema job. |
| Temporal UI `cannot unmarshal tcp://... into int` | Kubernetes service-link environment collision; disable service links. |

## Bootstrap and Flux Flow

### Phase 0: Host/Talos bootstrap

- Talos maintenance API reachable.
- disk detected.
- machine config applied.
- installer image pulled.
- Kubernetes bootstrapped.
- kubeconfig retrieved.
- node Ready.

### Phase 1: Platform prerequisites

- CoreDNS resolver config.
- local-path storage.
- storage smoke test.
- Flux controllers.

### Phase 2: Status service

- Generate token.
- Create `appliance-system` namespace and status auth Secret.
- Install `appliance-status`.
- Print status URL and token.

### Phase 3: Core app

- Install login-critical services.
- Wait for `CORE_READY`, `BOOTSTRAP_READY`, and `LOGIN_READY`.
- Print login URL as soon as ready.

### Phase 4: Background services

- Install email-service, Temporal, workflow-worker, temporal-worker, and future background services.
- Failures set `Ready with background issues` rather than blocking login.

### Phase 5: Full health/support

- Report `FULLY_HEALTHY` when all selected services are healthy.
- Provide support bundle and remediation controls in later iterations.

## Flux/Helm Organization

Restructure appliance Flux resources into tiered groups:

```text
ee/appliance/flux/base/
  platform/
    appliance-status.yaml
  core/
    alga-core.yaml
    pgbouncer.yaml
  background/
    temporal.yaml
    email-service.yaml
    workflow-worker.yaml
    temporal-worker.yaml
```

Prefer separate Flux `Kustomization`s:

```text
alga-platform
alga-core
alga-background
```

Dependencies:

```text
alga-core depends on alga-platform
alga-background depends on alga-core
```

`alga-background` failure must not change `LOGIN_READY=false`.

## Implementation Milestones

1. Status schema and CLI visibility.
2. Early `appliance-status` chart/service.
3. Core/background tier split.
4. Durable chart/operator fixes from the observed run.
5. Support bundle and guided remediation actions.

## Durable Fixes from Observed Run

- Explicit DNS support and visibility in Talos bootstrap.
- Fix `reset-appliance-data.sh` `target: unbound variable` failure.
- Prevent operator wrapper from overwriting valid Talos credentials when explicit kubeconfig/talosconfig are supplied.
- Fix or avoid Postgres PVC subPath initialization failure.
- Ensure Temporal chart runs autosetup correctly.
- Disable service links for Temporal UI and any other pod vulnerable to service-env collisions.
- Validate release manifest image tags before applying background releases.
- Classify large image pulls separately from stalled installs.

## Acceptance Criteria

1. Fresh appliance bootstrap prints a status URL and token within the first few minutes after Kubernetes is ready.
2. Status UI is reachable at `http://<node-ip>:8080` and requires the generated token.
3. Status UI reports tiered readiness and top blockers.
4. Alga core reaching `LOGIN_READY` is reported independently of background services.
5. A missing workflow-worker image tag produces `Ready with background issues` when login is otherwise available.
6. Generic Helm timeout is not the top blocker when a lower-level pod/event cause is known.
7. Release manifest validation catches missing background image tags before or during background install.
8. A local UTM/Talos smoke run can reproduce: status UI early, login-ready core, and background-degraded reporting.
