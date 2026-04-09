# SCRATCHPAD — Workflow V2 Temporal Hard-Cutover Remediation

## Purpose

Focused follow-up plan for the remaining blockers after the broader Temporal-native runtime plan.

Parent plan:
- `ee/docs/plans/2026-04-08-workflow-v2-temporal-native-runtime/`

## User-approved scope decisions

- Scope choice: **B**
  - include the 3 remaining review items plus adjacent operator/runtime cleanup needed to make hard cutover shippable
- Legacy operator behavior for Temporal runs: **A — hard fail**
  - do not translate old DB-runtime-style actions for Temporal-backed runs
- Event correlation source: **C — support both**
  - explicit correlation if present
  - configured derivation if explicit correlation is absent
- Expression parity posture: **A — exact parity**
  - Temporal must use the same expression contract as the canonical workflow runtime
- Cutover posture: **hard cutover**
  - shared / legacy DB-runtime authority can be removed for Workflow Runtime V2

## Review findings this plan addresses

1. Expression engine parity gap
   - `ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts`
   - custom JSONata evaluator diverges from canonical expression contract in `shared/workflow/runtime/expressionEngine.ts`
   - known gap: missing `nowIso()` support
   - likely additional gap: skipped guardrails/allowed-function enforcement

2. Remaining DB/legacy authority over Temporal runs
   - `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
   - `resumeWorkflowRunAction()` still mutates waits/runs and calls `WorkflowRuntimeV2.executeRun(...)`
   - `retryWorkflowRunAction()` still calls `WorkflowRuntimeV2.executeRun(...)`
   - `submitWorkflowEventAction()` still resolves waits through DB authority patterns
   - `cancelWorkflowRunAction()` still projects `CANCELED` even if Temporal cancel fails

3. Event ingress correlation bug
   - `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts`
   - currently uses `event.event_id` as correlation key for audit, candidate lookup, and Temporal signal payload
   - real `event.wait` steps typically correlate on business keys like ticket/project/account identifiers

## Constraints / implementation guardrails

- Prefer explicit failure over silent fallback.
- Do not preserve hybrid authority between Temporal and DB runtime for V2.
- DB tables remain projection/index/audit surfaces only.
- Candidate lookup may use DB indexes, but Temporal remains the only resume authority.
- Unsupported Temporal actions should fail loudly and clearly for operators/support.

## Likely affected files

- `ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts`
- `shared/workflow/runtime/expressionEngine.ts`
- `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- `ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts`
- `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts`
- `packages/event-bus/src/schemas/workflowEventSchema.ts`
- `shared/workflow/persistence/workflowRunWaitModelV2.ts`

## Expected test areas

- Temporal workflow/runtime unit tests
- server/API unit tests for run-control actions
- workflow worker event-ingress tests
- possibly one DB-backed integration path for correlation routing/projection sanity

## Notes

- Existing broader runtime plan already covers the end-state architecture.
- This focused plan is meant to track the remaining hard-cutover blockers as a shippable remediation slice.

## Progress — 2026-04-09 (Run-control hard cutover)

### Completed scope in this pass

- Implemented hard-fail guardrails for legacy run-control actions on Temporal runs in:
  - `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- Added explicit unsupported-action boundary for Temporal runs:
  - `resumeWorkflowRunAction` now fails with `409` + code `WORKFLOW_TEMPORAL_ACTION_UNSUPPORTED`
  - `retryWorkflowRunAction` now fails with `409` + code `WORKFLOW_TEMPORAL_ACTION_UNSUPPORTED`
  - `requeueWorkflowRunEventWaitAction` now fails with `409` + code `WORKFLOW_TEMPORAL_ACTION_UNSUPPORTED`
- Fixed Temporal cancel authority semantics:
  - `cancelWorkflowRunAction` now calls Temporal cancel first and **does not** project DB `CANCELED` state if Temporal cancel fails.
  - Failure path now returns explicit `409` + code `WORKFLOW_TEMPORAL_CANCEL_FAILED` with actionable hint.

### Key decisions and rationale

- Decision: treat legacy admin controls (`resume`, `retry`, `requeue_event_wait`) as unsupported for `engine='temporal'`.
  - Rationale: enforces single execution authority (Temporal) and prevents split-brain DB projection mutations.
- Decision: cancel remains supported for Temporal runs, but only when the Temporal cancel request succeeds.
  - Rationale: prevents false projection of cancellation when workflow execution is still active.

### Tests added/updated

- Updated `server/src/test/integration/workflowRuntimeV2.control.integration.test.ts`:
  - New: Temporal resume hard-fails with explicit unsupported-action details and no wait/run mutation.
  - New: Temporal retry hard-fails with explicit unsupported-action details and keeps failed run projection unchanged.
  - New: Temporal cancel failure leaves run/waits in WAITING state and returns explicit error details.
- Added test mocking for Temporal cancel client call via:
  - `vi.mock('@alga-psa/workflows/lib/workflowRuntimeV2Temporal', ...)`

### Commands / runbook used

- Focused integration run (full file):
  - `cd server && npm run -s test -- src/test/integration/workflowRuntimeV2.control.integration.test.ts`
  - Result: suite has a pre-existing unrelated failure (`STARTED invocation with stale lease is treated as TransientError`) not introduced by these changes.
- Focused validation for new Temporal tests only:
  - `cd server && npm run -s test -- src/test/integration/workflowRuntimeV2.control.integration.test.ts -t "Temporal runs reject legacy|Temporal cancel failure"`
  - Result: passed.

### Current gaps / next work

- Expression parity hard-cutover items (`F003`+) are still open:
  - Temporal workflow file still has a local JSONata evaluator and local normalization/guard logic.
- Event-ingress correlation/authority items (`F018`+) remain open.

