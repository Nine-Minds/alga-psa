# Scratchpad — Appliance Temporal Tenant Bootstrap

- Plan slug: `appliance-temporal-tenant-bootstrap`
- Created: `2026-07-09`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-07-09) Use a dedicated coordinated appliance release so hosted traffic
  promotion is not coupled to appliance artifact promotion.
- (2026-07-09) Publish config/charts immutably before moving stable; the final
  channel move is the only externally visible promotion operation.
- (2026-07-09) Keep pointer-only releases for true image-only changes, but fail
  closed when changed paths require worker or config artifacts.

## Discoveries / Constraints

- (2026-07-09) Stable contained algaCore `5f2b42b2`, temporalWorker `c97989d`,
  chart `0.0.0-appliance.bf9f1327`, and config digest `sha256:5c38e267...`.
- (2026-07-09) The failed bootstrap log used the old message and invoked TSX;
  the new chart includes `(Temporal tenantCreationWorkflow)` in the log message.
- (2026-07-09) `temporal-worker:5f2b42b2` did not exist in GHCR.
- (2026-07-09) Appliance bootstrap is a regular Job and alga-core uses
  `disableWait`, allowing Temporal/background releases to become available while
  the Job waits for the worker.
- (2026-07-09) The single-node profile uses `bootstrap.mode: recover`, so the
  partially migrated local database can be retried safely when no user exists.
- (2026-07-09) `helm template` renders the bootstrap Job with the `.mjs`
  client, local Temporal frontend, `default` namespace, and
  `tenant-workflows` queue. The queue comes from the chart default rather than
  the single-node profile.

## Commands / Runbooks

- (2026-07-09) Resolve stable with
  `setup-engine.mjs#resolveReleaseManifest("stable")` and always inspect images,
  controlPlane, config, and charts together.
- (2026-07-09) Build Temporal worker with
  `WorkflowTemplate/temporal-worker-build`; publish config with
  `WorkflowTemplate/alga-appliance-config-publish` without promotion; perform
  the final move from the immutable config release.
- (2026-07-09) Render the effective Job with
  `helm template alga-core ./helm --namespace msp -f ee/appliance/flux/profiles/single-node/values/alga-core.single-node.yaml --show-only templates/jobs.yaml`.

## Links / References

- Commit: `5f2b42b20b01e3fa9bd55f71e99a21c6136580d9` / PR #2893.
- `server/scripts/appliance-create-tenant.mjs`
- `helm/templates/appliance-bootstrap-configmap.yaml`
- `helm/templates/jobs.yaml`
- `ee/temporal-workflows/src/workflows/shared/tenant-creation-steps.ts`
- `ee/appliance/flux/base/flux/kustomizations.yaml`

## Open Questions

- None currently.
