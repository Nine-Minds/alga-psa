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

- Event-ingress correlation/authority items (`F018`+) remain open.
- Expression parity items referenced here were addressed in the next section (`Expression parity cutover`).


## Progress — 2026-04-09 (Expression parity cutover)

### Completed scope in this pass

- Replaced Temporal workflow-local expression evaluation with canonical workflow expression contract in:
  - `ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts`
- Removed local Temporal-only JSONata helpers from workflow execution path:
  - removed local evaluator/normalizer and now uses canonical `compileExpression` from `@alga-psa/workflows/runtime/expressionEngine`
- Removed Temporal-only `nowIso()` control-flow ban.
  - Temporal workflow now accepts `nowIso()` with canonical function set/validation behavior.

### Key decisions and rationale

- Decision: import expression contract from `@alga-psa/workflows/runtime/expressionEngine` directly instead of `@alga-psa/workflows/runtime` barrel.
  - Rationale: avoids pulling unrelated transitive runtime package entry dependencies into temporal workflow unit test bundle (`@alga-psa/storage` resolution issue).
- Decision: cache compiled expressions per source string in-workflow (`Map<string, CompiledExpression>`).
  - Rationale: preserves behavior and avoids repeated compile cost while remaining deterministic for replayed source strings.

### Tests added/updated

- Updated `ee/temporal-workflows/src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts`:
  - nowIso parity: `control.if` accepts `nowIso()` via canonical engine.
  - normalization parity: `==` source normalization path works in Temporal execution.
  - disallowed-function parity: rejects unsupported functions with canonical validation.
  - output guardrail parity: expression result over max size fails with canonical guardrail error.

### Commands / runbook used

- Temporal workflow unit suite (targeted):
  - `cd ee/temporal-workflows && npx vitest run src/workflows/__tests__/workflow-runtime-v2-run-workflow.test.ts`
  - Result: passed (30 tests).

### Current gaps / next work

- Determinism replay proof item (`F009` / `T003`) is still open:
  - need a dedicated replay-focused test that demonstrates no expression-contract drift across replay.
- Event ingress correlation and API/stream alignment (`F018+`) remain open.

## Progress — 2026-04-09 (Event-ingress authority guard for Temporal)

### Completed scope in this pass

- Added Temporal guard in API event ingestion path (`submitWorkflowEventAction`) to prevent legacy DB-authoritative resume for Temporal runs:
  - file: `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
  - behavior: if a matched candidate wait belongs to `engine='temporal'`, ingestion fails explicitly (`409`) and records an audit error message; no wait/run projection mutation is performed for that Temporal run.

### Key decisions and rationale

- Decision: hard-fail API resume attempts for Temporal candidate runs in the legacy DB event-resume code path.
  - Rationale: prevents `WorkflowRuntimeV2.executeRun(...)` from being an authority path for Temporal runs in operator/API control surfaces.

### Tests added/updated

- Updated `server/src/test/integration/workflowRuntimeV2.control.integration.test.ts`:
  - New: `Submit workflow event rejects legacy DB-authoritative resume for Temporal runs`
  - Asserts:
    - explicit `409` failure
    - wait remains `WAITING`
    - run remains `WAITING`
    - runtime event audit row includes Temporal-unsupported error metadata

### Commands / runbook used

- Focused server integration run for Temporal guard tests:
  - `cd server && npm run -s test -- src/test/integration/workflowRuntimeV2.control.integration.test.ts -t "Temporal runs reject legacy|Temporal cancel failure|Submit workflow event rejects legacy DB-authoritative resume for Temporal runs"`
  - Result: passed.


## Progress — 2026-04-09 (Stream correlation contract)

### Completed scope in this pass

- Extended workflow event stream schema/contracts to carry explicit workflow correlation:
  - `packages/event-schemas/src/schemas/workflowEventSchema.ts`
  - `packages/event-bus/src/schemas/workflowEventSchema.ts`
  - `packages/event-schemas/src/schemas/eventBusSchema.ts` (`WorkflowPublishHooks.correlationKey`, `convertToWorkflowEvent` mapping)
  - `packages/event-bus/src/eventBus.ts` (publishes `workflow_correlation_key` in stream payload)
- Updated stream ingestion worker correlation logic:
  - `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts`
  - correlation resolution order:
    1. explicit (`event.workflow_correlation_key`, `payload.workflowCorrelationKey`, `payload.correlationKey`)
    2. configured derivation paths from `WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON` (event-specific and `*` wildcard)
  - no fallback to `event_id` for wait routing
  - resolved key persisted in `workflow_runtime_events.correlation_key`
  - wait candidate lookup uses resolved key (`tenant + event_name + resolved correlation`)
  - Temporal signal payload carries resolved correlation key
  - unresolved correlation writes audit error metadata and skips wait routing/signaling

### Key decisions and rationale

- Decision: use env-configured derivation paths as the immediate configurable source (`WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON`).
  - Rationale: provides explicit, event-type-specific derivation without introducing schema migrations in this remediation slice.
- Decision: fail open for event-triggered workflow launches but fail closed for wait routing when correlation is missing.
  - Rationale: preserves event-triggered starts while preventing false-positive wait matches.

### Tests added/updated

- Updated `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts`:
  - explicit correlation routes candidate waits/signals by resolved key (not `event_id`)
  - configured derivation from payload path routes correctly
  - unresolved correlation writes audit error and skips wait-routing/signaling

### Commands / runbook used

- Stream worker unit tests:
  - `cd services/workflow-worker && npx vitest run src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts`
  - Result: passed (4 tests).

### Current gaps / next work

- API ingress still needs full correlation-derivation parity and Temporal-signal-only resume path alignment (`F024`, `F025`, `F026`, `F028`, `T010`).
- Determinism replay test (`F009` / `T003`) and cutover regression/projection tests (`T011`, `T012`) remain open.

