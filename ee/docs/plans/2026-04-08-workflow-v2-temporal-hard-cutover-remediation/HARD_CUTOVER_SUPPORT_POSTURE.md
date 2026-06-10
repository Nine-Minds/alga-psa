# Workflow Runtime V2 Temporal Support Posture

Date: 2026-04-09 (updated 2026-06-09: DB engine removed entirely)
Scope: all Workflow Runtime V2 runs

## Authority model

- Temporal is the only execution engine. The DB-polling engine, its env flags
  (`WORKFLOW_RUNTIME_V2_ENABLE_TEMPORAL_POLLING`,
  `WORKFLOW_RUNTIME_V2_ENABLE_DB_POLLING`), and the legacy run-control actions
  were removed in the temporal-only cutover
  (see `../2026-06-09-temporal-only-workflow-engine-design.md`).
- Database workflow run/wait/event tables are projection, indexing, and audit
  surfaces.
- Historical rows with `engine = 'db'` are read-only; stranded active rows were
  finalized as CANCELED by migration
  `20260609120000_cancel_stranded_db_engine_workflow_runs`.

## Operator/API run-control support matrix

- `cancel`: supported
  - Behavior: cancel request is sent to Temporal first.
  - Failure behavior: cancel fails explicitly; DB projection is not
    optimistically set to `CANCELED`.
- `replay`: supported
  - Behavior: starts a fresh Temporal run with the original (or operator-edited)
    payload; the UI navigates to the new run.
- `resume` / `retry` / `requeue_event_wait`: removed
  - The actions, API routes, and Run Studio buttons no longer exist. Use
    replay (or quota-pause resume, which is Temporal-native) instead.

## Event ingress posture

- Stream/API ingress must route waits by resolved workflow correlation keys (not `event_id` fallback).
- Correlation resolution order:
  - explicit correlation in event envelope/payload
  - configured derivation paths
- If correlation cannot be resolved for wait routing:
  - event is audited with clear correlation-resolution error metadata
  - wait routing/signaling is skipped

## Support guidance

- A run showing `RUNNING` with zero steps means no worker is consuming the
  `workflow-runtime-v2` task queue (worker down or Temporal unreachable); the
  run page surfaces this with a queued-waiting-for-worker warning after 60s.
- Use `workflow_runtime_events.correlation_key` and `error_message` for event-routing debugging.
