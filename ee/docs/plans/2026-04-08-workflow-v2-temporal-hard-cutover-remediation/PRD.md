# PRD — Workflow V2 Temporal Hard-Cutover Remediation

- Slug: `workflow-v2-temporal-hard-cutover-remediation`
- Date: `2026-04-08`
- Status: Draft
- Parent context: `ee/docs/plans/2026-04-08-workflow-v2-temporal-native-runtime/`

## Summary

Close the remaining correctness and cutover gaps in Workflow Runtime V2 so Temporal becomes the only execution authority for new EE workflow runs. This remediation package focuses on three blocking areas:

1. **Expression engine parity** — Temporal workflow code must use the same expression semantics and guardrails as the canonical workflow runtime contract.
2. **Operator/API authority cleanup** — Temporal runs must no longer be resumed, retried, or event-resolved through DB-authoritative or legacy-runtime paths.
3. **Real event correlation for ingress** — stream-ingested workflow events must use the authored workflow correlation contract rather than incorrectly keying event waits off `event_id`.

This is a **hard cutover** plan. For Workflow Runtime V2, the old DB/shared execution runtime is not a supported authority for Temporal-backed runs and may be removed or explicitly blocked wherever it can still interfere.

## Problem

The Temporal-native runtime implementation is close to viable, but several remaining paths still violate the hard-cutover model:

1. **Temporal expression behavior is not canonical yet**
   - The workflow sandbox currently carries its own JSONata evaluator instead of reusing the canonical workflow expression contract.
   - This creates compatibility gaps such as missing `nowIso()` support and bypasses shared validation/guardrails.

2. **Temporal runs can still be driven by legacy DB/runtime paths**
   - Operator/API flows still mutate wait rows and run rows directly or call `WorkflowRuntimeV2.executeRun(...)` for Temporal runs.
   - That recreates split-brain execution authority and can produce divergence between Temporal state and DB projection.

3. **Event ingress correlation is wrong for real stream traffic**
   - The stream worker currently routes candidate waits by `event_id` instead of a workflow correlation key.
   - Real authored `event.wait` steps typically correlate on business keys like ticket ID or project ID, so stream ingress can fail to resume correct waits.

4. **Hard cutover is incomplete operationally**
   - Some old code paths are still reachable and can affect Temporal runs.
   - Without explicit blocking or removal, support engineers and APIs can accidentally invoke unsupported behavior.

## Goals

1. Make Temporal expression evaluation **exactly match** the canonical workflow expression contract.
2. Enforce a strict execution-authority boundary: Temporal runs are controlled by Temporal, not the old DB/shared runtime.
3. Make event ingress correlation correct for real business events by supporting explicit correlation and configured derivation.
4. Preserve DB tables as **projection, audit, and indexing surfaces only**, not execution authority.
5. Ship a focused hard-cutover package that is safe to roll out without keeping hybrid fallback behavior.

## Non-goals

- Reintroducing a long-term hybrid engine where Temporal and the old DB runtime are both supported authorities.
- Preserving admin/operator flows that only make sense for the legacy DB runtime.
- Designing a broad new operator UI for Temporal-specific controls in this plan.
- Expanding workflow DSL scope beyond what is needed to close the cutover blockers.
- Building comprehensive observability features beyond what is needed to support the cutover safely.

## Users and Primary Flows

### Primary users

- **Workflow authors** who expect authored expressions and waits to behave consistently regardless of runtime internals.
- **Operators/support engineers** who inspect runs and may trigger admin actions like cancel, replay, retry, or resume.
- **Platform engineers** responsible for event ingress, runtime correctness, and cutover safety.

### Primary flows

#### Flow 1: Temporal workflow evaluates authored expressions
1. A Temporal-backed workflow run loads its pinned definition.
2. The interpreter evaluates expressions for control flow, waits, mappings, and assignments.
3. The Temporal runtime must honor the same allowed functions, normalization, validation, and failure behavior as the canonical workflow expression contract.

#### Flow 2: Operator acts on a Temporal run
1. An operator invokes a run action such as cancel, retry, or resume.
2. If the action is not supported for Temporal in a Temporal-native way, the system must fail explicitly.
3. The system must not mutate DB projection rows as if that were sufficient to control execution.

#### Flow 3: Event enters workflow ingress
1. A workflow event is ingested from the stream or API.
2. The system resolves the workflow correlation key using either:
   - explicit correlation from the event payload/envelope, or
   - configured derivation rules for that event type.
3. Candidate Temporal waits are looked up using tenant + event name + resolved correlation.
4. Candidate Temporal runs are signaled.
5. Each Temporal workflow decides whether the signaled event matches its active wait contract.

## UX / UI Notes

- Existing workflow authoring UX should not expose Temporal concepts.
- Admin/operator surfaces should show **clear unsupported-action errors** when a legacy action is attempted against a Temporal run.
- Existing run detail screens may continue to use DB projection data, but those projections must not imply DB-side execution authority.
- Event wait debugging should remain understandable to support engineers by showing the resolved correlation key used for candidate routing.

## Requirements

### Functional Requirements

#### FR-1: Canonical expression engine parity
- Temporal workflow execution must use the same canonical expression semantics as the workflow runtime contract used for publish validation and runtime evaluation.
- Supported workflow expression functions must match exactly, including `nowIso()` and any other approved helper functions.
- Expression source normalization behavior must match exactly.
- Disallowed functions must be rejected consistently.
- Expression evaluation must preserve the same JSON-serializability and output-size guardrails expected by the canonical contract.
- Temporal runtime must not keep a second divergent workflow-expression contract.

#### FR-2: Temporal-only authority for Temporal runs
- Any run with `engine = 'temporal'` must not be resumed, retried, or advanced by calling the old DB/shared runtime executor.
- Legacy run-control code must not mutate Temporal run projection rows in ways that pretend execution authority was transferred.
- DB rows for Temporal runs must remain projection/audit/index state only.
- The system must fail fast when an unsupported legacy execution-control action is invoked for a Temporal run.

#### FR-3: Operator/API hard-fail boundary
- `resume` on Temporal runs must fail explicitly unless and until a dedicated Temporal-native resume contract exists.
- `retry` on Temporal runs must fail explicitly unless and until a dedicated Temporal-native retry contract exists.
- Any API path that still assumes DB wait resolution or direct `executeRun(...)` control must fail explicitly for Temporal runs.
- Error responses must be actionable enough for support engineers to understand which action is unsupported and why.

#### FR-4: Cancel semantics remain Temporal-authoritative
- Canceling a Temporal run must go through Temporal first.
- The system must not silently mark the DB projection canceled if the Temporal cancel request fails.
- Projection updates for cancellation must reflect accepted or completed Temporal cancellation semantics, not optimistic DB-only mutation.

#### FR-5: Event ingress correlation contract
- Workflow event ingress must support an explicit correlation field for routing waits.
- Workflow event ingress must also support configured derivation of correlation when explicit correlation is absent.
- The resolved correlation key must be persisted for audit/debugging.
- Candidate wait lookup must use the resolved correlation key, not `event_id`, except where the authored wait intentionally uses that value.
- Signal payloads sent to Temporal runs must carry the resolved workflow correlation key.

#### FR-6: Stream and API ingress alignment
- Stream-ingested workflow events and API-submitted workflow events must follow the same correlation-resolution contract.
- Event ingestion must not directly resolve Temporal wait rows as an execution authority shortcut.
- Temporal-backed waits must resume through Temporal signals only.
- Candidate selection may still use DB projection indexes, but only as a routing/indexing aid.

#### FR-7: Legacy runtime retirement for Workflow Runtime V2
- No supported Workflow Runtime V2 path should require `WorkflowRuntimeV2Worker` due-wait polling or DB-runnable-run acquisition for Temporal runs.
- `WorkflowRuntimeV2.executeRun(...)` must not remain in any supported control path for Temporal-backed Workflow Runtime V2 runs.
- Legacy-only operator/event paths may be removed or gated so they cannot affect Temporal runs.

#### FR-8: Product projections remain valid
- `workflow_runs`, `workflow_run_steps`, `workflow_run_waits`, and `workflow_runtime_events` must remain accurate enough to power existing product views and support debugging.
- Projection records should include the correlation data and error metadata needed to explain routing outcomes and unsupported-action failures.

### Non-functional Requirements

- The cutover must prefer explicit failure over silent fallback.
- Runtime behavior must remain deterministic under Temporal replay.
- Temporal expression behavior must be testable as a stable contract.
- Event-correlation behavior must be tenant-safe and auditable.
- The design should minimize the number of surviving legacy code paths.

## Data / API / Integrations

### Relevant files

- `ee/temporal-workflows/src/workflows/workflow-runtime-v2-run-workflow.ts`
- `ee/temporal-workflows/src/workflows/workflow-runtime-v2-interpreter.ts`
- `shared/workflow/runtime/expressionEngine.ts`
- `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- `ee/packages/workflows/src/lib/workflowRuntimeV2Temporal.ts`
- `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts`
- `packages/event-bus/src/schemas/workflowEventSchema.ts`
- `shared/workflow/persistence/workflowRunWaitModelV2.ts`

### Integration notes

- The preferred shape is a **single canonical expression contract** reused by Temporal-native execution.
- Event ingress should resolve a workflow correlation key before candidate lookup and before signaling Temporal runs.
- Admin/operator APIs should branch on `engine` and hard-fail unsupported Temporal actions instead of trying to bridge back to the old runtime.

## Risks

1. **Accidental hybrid behavior survives in one forgotten API path**
   - Mitigation: enumerate and test all supported control paths for Temporal runs.

2. **Expression parity changes break existing authored workflows**
   - Mitigation: enforce exact contract reuse and add parity-focused tests.

3. **Correlation derivation becomes ambiguous across event types**
   - Mitigation: require explicit configuration and fail clearly when correlation cannot be resolved.

4. **Support workflows lose convenient admin shortcuts during cutover**
   - Mitigation: fail explicitly and document unsupported actions rather than silently doing the wrong thing.

## Rollout / Migration Notes

- This plan assumes **hard cutover** for Workflow Runtime V2.
- Temporal-backed runs are the only supported execution model for new Workflow Runtime V2 runs.
- Legacy DB/shared-runtime execution paths that can still affect Temporal runs should be removed or blocked.
- No attempt should be made to preserve compatibility for unsupported legacy admin actions against Temporal runs unless a dedicated Temporal-native design is added later.

## Open Questions

1. Which exact event schema/config surface should own correlation derivation rules for stream-ingested workflow events?
2. Should explicit correlation be optional at the event schema layer or required for selected event types only?
3. For unsupported Temporal operator actions, should APIs return `409`, `422`, or a dedicated error code contract?

## Acceptance Criteria / Definition of Done

This plan is done when:

1. Temporal workflow expression evaluation uses the canonical workflow expression contract with no known parity gaps.
2. No supported Temporal-run operator/API path invokes the old DB/shared runtime executor.
3. Unsupported Temporal legacy actions fail explicitly and do not mutate run/wait projection state as execution authority.
4. Cancel semantics for Temporal runs are no longer DB-optimistic.
5. Stream and API workflow event ingress resolve and use real workflow correlation keys instead of defaulting to `event_id`.
6. Candidate Temporal waits are routed by tenant + event name + resolved correlation.
7. Focused tests cover expression parity, unsupported operator actions, cancel authority, and explicit/derived event correlation.
