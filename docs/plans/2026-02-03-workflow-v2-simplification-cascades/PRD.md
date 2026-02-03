# PRD: Workflow V2 Conceptual Simplification Cascades

- Slug: `2026-02-03-workflow-v2-simplification-cascades`
- Date: `2026-02-03`
- Status: Draft

## Summary

Workflow v2 is already powerful, but it carries several *parallel abstractions* (nodes vs actions, multiple validation layers, payload contract negotiation, ID-centric portability, path-string execution) that multiply complexity for users and developers.

This plan applies a set of **conceptual simplification cascades**—each one is intended to remove entire *categories* of code and edge-cases without reducing capability:

1. **Nodes are Actions + Effects**: collapse node types into actions that can return “effects” (wait/human task) or “state updates” (envelope assignments).
2. **Workflows are addressed by `key`**: make `workflow.key` the stable identity, including for `callWorkflow`, and treat DB IDs as internal implementation details.
3. **The trigger event schema is the workflow input contract**: remove “payload schema negotiation” and publish-time inference; keep mapping as explicit steps.
4. **Bundle validity is publish validity**: remove separate Ajv JSON-schema validation and dependency summaries; validate bundles by running the same v2 publish validation against live registries.
5. **(Optional) Compile at publish, execute a tiny VM**: replace path-string navigation (`root.steps[0]...`) with a compiled instruction stream and numeric program counter.

## Problem

We want workflow automation to be user-authored and safe, but the current system expresses the same underlying ideas in multiple ways:

- **Two primitives for “doing things”**: v2 has “node types” (handlers + config schemas) and also “actions” (input schemas + execution), creating duplicated validation and dependency tracking.
- **Multiple payload contracts**: workflow payload schema vs event payload schema vs trigger mapping creates a large, fragile matching matrix.
- **Portability fights IDs**: bundling/import rewriting works today, but cross-workflow references (`callWorkflow`) are naturally portable only if addressed by key.
- **Multiple validation stacks**: Ajv bundle JSON-schema + dependency summaries + publish validation overlap.
- **Runtime navigation complexity**: current nodePath strings and stack-walking are correct but hard to reason about and extend.

## Goals

1. Reduce the workflow engine’s *conceptual surface area* (fewer orthogonal abstractions).
2. Preserve (or improve) user-visible capability: event triggers, waits, human tasks, retries, error handling, mapping, action calls, audit/logging.
3. Improve portability: export/import should be stable across environments with minimal rewriting and fewer “missing dependency” false negatives.
4. Make extension authoring easier: one primary “hook surface” (actions) instead of splitting logic between actions and node handlers.
5. Reduce validation duplication: one authoritative publish validation used consistently across UI, API, and bundle import.
6. Maintain safe and observable execution: idempotency, leases, logs, snapshots, and redaction remain first-class.

## Non-goals

- Replacing the existing v2 workflow runtime with Temporal.
- Redesigning the workflow designer UI (beyond changes required to represent the simplified model).
- Removing support for already-published workflows without a migration path.
- Changing product-level permissions semantics (workflow manage/publish/admin) beyond necessary refactors.

## Users and Primary Flows

### Personas

- **MSP Admin / Automation Owner**: authors workflows; cares about reliability, easy reuse, and safe rollouts.
- **MSP Technician**: interacts with human tasks and workflow outcomes.
- **Platform/EE Developer**: extends automation via new actions and schemas; cares about clean extension points.
- **Operator/SRE**: needs deterministic deploys, observability, and safe migration mechanics.

### Primary flows

1. Create/edit workflow draft in designer.
2. Publish workflow with clear validation results and predictable contract.
3. Trigger workflow via an event (domain event catalog).
4. Workflow waits for event or human task; resumes deterministically.
5. Export workflow(s) as a bundle; import into another env; publish.
6. Debug execution via run logs, step history, snapshots, and dead-letter views.

## UX / UI Notes

- Designer should present a single concept for executable steps:
  - **Control blocks** (if/forEach/tryCatch/callWorkflow/return)
  - **Action step** (with action picker, version, mapping, retries, saveAs)
- “Wait” and “Human Task” should appear as action steps in the palette (internally returning an effect).
- The UI should guide users to explicit mapping steps instead of hidden trigger mappings.
- Contract clarity:
  - Event-triggered workflows clearly show: “Input schema = event schema ref (from catalog / override)”.
  - Any shape transformations are visible as steps.

## Requirements

### Functional Requirements

#### R1 — Action + Effect runtime primitive

- Actions may return:
  - **Envelope updates** (same as today: assign into `payload/vars/meta`)
  - **Effects**: `wait(event|human|retry|timeout, ...)` with persisted wait records
- The runtime must execute action steps uniformly.
- Built-in functionality currently implemented as node handlers must be expressible as actions:
  - assign/transform
  - state set
  - wait for event
  - create human task
  - email helpers (parse body, render comment blocks)

#### R2 — Remove node-type registry from the execution model

- Workflow definition schema uses only:
  - control blocks (`control.*`)
  - action step (`action.call` or equivalent unified action-step schema)
- Node registry becomes UI-only metadata (optional) or is removed entirely.

#### R3 — Key-addressed workflows

- `workflow.key` is required and unique.
- `control.callWorkflow` references a workflow by `{ workflowKey, workflowVersion }` (or `{ workflowKey, version: "latest" }`).
- Bundle import/export operates on keys without rewriting internal references.

#### R4 — Single payload contract for event triggers

- For event-triggered workflows, the **effective source payload schema ref** is the workflow’s payload contract.
- Trigger mapping is removed or reduced to sugar that inserts explicit mapping steps at the top of the workflow.

#### R5 — Bundle validation collapses into publish validation

- Bundle import validates each workflow by running v2 publish validation with live registries.
- Bundle “dependencies” summary becomes optional metadata at most (not required for correctness).
- Ajv schema validation for the bundle format is eliminated or reduced to minimal header checks.

#### R6 — Optional compiled execution model (VM)

- At publish time, compile workflow definition to:
  - a linear instruction stream
  - a numeric program counter (PC)
  - explicit jump targets for control flow
- Runtime executes compiled instructions; source mapping links PC back to human-readable step paths for logs/UI.

### Non-functional Requirements

- Backwards compatibility:
  - Existing published workflows continue to run.
  - Migrations provide safe upgrade paths (auto-migrate where possible, otherwise block publish with actionable errors).
- Performance:
  - No significant regression in run throughput or latency.
  - Bundle import/export remains fast for 1–100 workflows.
- Reliability:
  - Leases, idempotency, and retries remain correct.
  - No increase in “stuck” runs due to migration.

## Data / API / Integrations

- Database:
  - Ensure `workflow_definitions.key` is required and unique (migration + backfill strategy).
  - Add fields as needed for compiled IR (e.g. `compiled_ir_json`, `compiled_at`, `compiler_version`).
- Event catalog integration:
  - Effective source schema ref is derived from catalog entry / override.
  - Validation uses schema registry.
- Action registry:
  - Becomes the canonical extension point for new capabilities.

## Security / Permissions

- Preserve existing permission levels: read/manage/publish/admin.
- Ensure bundle import/export is admin-only (or consistent with current rules).
- Ensure secret references are validated at publish and redacted in logs/snapshots.

## Observability

- Execution logs remain structured and redacted.
- Introduce explicit “effect” log entries (created wait, resolved wait, created human task).
- Add metrics for:
  - validation failures by code
  - bundle import outcomes
  - effect types frequency

## Rollout / Migration

1. Introduce the new model under a feature flag / compatibility layer.
2. Support “dual read” for published versions: if compiled IR exists use it; otherwise interpret source definition.
3. Provide a bulk migration tool:
  - generate keys if missing
  - migrate callWorkflow IDs to keys
  - replace trigger mapping with explicit steps
4. Stabilization window with telemetry and guarded rollout.
5. Remove legacy paths once all tenants are migrated and tests prove stability.

## Open Questions

1. Should “effects” be return values from actions, or should actions call a runtime API (`ctx.publishWait`) as today?
2. Do we require `workflow.key` for all workflows (system + tenant) immediately, or allow a phased enforcement?
3. Do we keep a bundle “format” header only, or move to fully self-describing “publishable workflow packs”?
4. Is compiled IR mandatory for new publishes, or optional and backfilled gradually?
5. What is the preferred version addressing for `callWorkflow` (“latest” vs explicit version)?

## Acceptance Criteria (Definition of Done)

- A workflow definition model exists with only control blocks + action steps.
- Node-type registry is no longer required for runtime execution.
- Event-triggered workflows have a single, explicit payload contract (schema ref) with explicit mapping steps.
- Bundle import/export works across environments without ID rewriting for cross-workflow references.
- A single publish-validation flow is used across UI publish, API publish, and bundle import.
- Comprehensive test coverage exists for execution, migration, and bundle round-trips.

