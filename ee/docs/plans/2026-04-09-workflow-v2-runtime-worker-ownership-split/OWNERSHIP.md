# Workflow Runtime V2 Worker Ownership (Operational Guide)

## Owner split

- `workflow-worker` owns authored Workflow Runtime V2 Temporal execution on queue `workflow-runtime-v2`.
- `workflow-worker` also owns authored workflow event-stream ingress and wait resume signaling.
- `temporal-worker` owns non-authored/domain Temporal workflows only.

## Queue expectations

- Authored queue: `workflow-runtime-v2` (owned by `workflow-worker`).
- Domain/non-authored queues remain on `temporal-worker`:
  - `tenant-workflows`
  - `portal-domain-workflows`
  - `email-domain-workflows`
  - `alga-jobs`
  - `sla-workflows`

## Debugging playbook

- Authored run not progressing:
  - inspect `workflow-worker` logs first
  - verify Temporal polling startup logs for queue `workflow-runtime-v2`
  - verify Temporal UI workers tab for queue `workflow-runtime-v2`
- Domain/job workflow issue:
  - inspect `temporal-worker` logs and queue health
- Misconfiguration guard:
  - `temporal-worker` startup now fails if configured with `workflow-runtime-v2`

## Runtime entrypoint contract

- Worker-safe import surface:
  - `@alga-psa/workflows/runtime/core`
  - no AI bootstrap wiring
- App/bootstrap-rich surface:
  - `@alga-psa/workflows/runtime` (re-exporting `runtime/bootstrap`)
  - retains AI inference + AI action registrations for server/bootstrap contexts
