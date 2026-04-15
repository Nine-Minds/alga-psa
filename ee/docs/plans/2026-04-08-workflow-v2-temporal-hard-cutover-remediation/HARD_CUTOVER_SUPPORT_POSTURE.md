# Workflow Runtime V2 Temporal Hard-Cutover Support Posture

Date: 2026-04-09
Scope: Workflow Runtime V2 runs with `engine = temporal`

## Authority model

- Temporal is the only execution authority for Temporal-backed Workflow Runtime V2 runs.
- Database workflow run/wait/event tables are projection, indexing, and audit surfaces.
- Legacy DB-runtime control paths are intentionally blocked for Temporal runs.

## Operator/API run-control support matrix

- `cancel`: supported
  - Behavior: cancel request is sent to Temporal first.
  - Failure behavior: cancel fails explicitly; DB projection is not optimistically set to `CANCELED`.
- `resume`: unsupported
  - Behavior: fails explicitly with actionable unsupported-action error.
- `retry`: unsupported
  - Behavior: fails explicitly with actionable unsupported-action error.
- `requeue_event_wait`: unsupported
  - Behavior: fails explicitly with actionable unsupported-action error.

## Event ingress posture

- Stream/API ingress must route waits by resolved workflow correlation keys (not `event_id` fallback).
- Correlation resolution order:
  - explicit correlation in event envelope/payload
  - configured derivation paths
- If correlation cannot be resolved for wait routing:
  - event is audited with clear correlation-resolution error metadata
  - wait routing/signaling is skipped

## Support guidance

- For Temporal-backed runs, do not use legacy admin shortcuts that imply DB-side execution authority.
- If an unsupported action is attempted, use Temporal-native controls or replay/start-new-run workflows where applicable.
- Use `workflow_runtime_events.correlation_key` and `error_message` for event-routing debugging.
