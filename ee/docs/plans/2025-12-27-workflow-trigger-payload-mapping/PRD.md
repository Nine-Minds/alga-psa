# PRD — Stable Workflow Payload Across Trigger Schema Changes

- Slug: `workflow-trigger-payload-mapping`
- Date: `2025-12-27`
- Status: Draft

## Summary
Workflows have a `payloadSchemaRef` that should remain stable over time, even if the trigger event’s schema evolves. This plan introduces an explicit “source payload schema” concept for event triggers and an optional trigger-level mapping (event payload → workflow payload). When the source schema ref matches the workflow payload schema ref, “no mapping” is a valid state and execution uses the payload as-is.

## Problem
Today, event-triggered workflows implicitly assume the inbound event payload already matches the workflow’s `payloadSchemaRef`. When the trigger event’s schema changes (or differs between tenants/system), workflows can silently stop running or become confusing to debug. Users also lack a clear UX for: (a) seeing the trigger’s source schema, (b) deciding whether they need a mapping, and (c) understanding whether a workflow is runnable for a given event payload schema.

## Goals
- Preserve the invariant: **workflow payload is stable** (`payloadSchemaRef` is the canonical contract for steps, mapping UI, expression autocomplete, etc.).
- Allow trigger event schemas to change independently of workflows, without breaking stable workflows when a mapping exists.
- Make “no mapping” a valid state when `sourcePayloadSchemaRef === payloadSchemaRef`.
- Block execution (not saving) when required mapping is missing or invalid; surface this via validation status/details.
- Record enough schemaRef/mapping provenance on events/runs for debugging and audit.

## Non-goals
- Automatic migration of existing workflows when event schemas change.
- Schema compatibility inference beyond `schemaRef` equality (i.e., “structurally compatible” schemas without mapping).
- Backward-compatibility layers for legacy event shapes (explicitly not required).
- A generalized “schema transform language” beyond existing mapping primitives (expressions / field refs / literals).

## Users and Primary Flows
### Users
- MSP admin / automation builder
- Internal support / engineers debugging automation

### Primary flows
1. **Build workflow**: choose trigger event → see source schemaRef → choose/confirm workflow payloadSchemaRef → if mismatch, define trigger mapping; if match, leave mapping empty.
2. **Publish workflow**: validator computes runnable status. If mismatch + missing mapping: publish fails; draft saves with invalid status.
3. **Ingest event**: event arrives with eventName + payload (and optionally a source schemaRef). System resolves `sourcePayloadSchemaRef`, then for each matching workflow version:
   - If refs match and no mapping: payload passes through unchanged.
   - If mapping exists: map → validate → start run (even when refs match).
   - If refs differ and mapping missing/invalid: do not start run.
4. **Run workflow (Run dialog)**: choose event type to seed “source schema”, enter source payload, run uses trigger mapping to produce workflow payload.
5. **Debug**: event list/run logs show source schemaRef used and whether mapping was applied.

## UX / UI Notes
- In the workflow designer trigger section:
  - Display the trigger’s **source schema ref** (from event catalog; optionally override-able).
  - Display the workflow’s **payload schema ref** (existing picker).
  - If refs match: show “Identity (no mapping required)” and hide mapping editor by default.
  - If refs differ: show required mapping editor (event → workflow payload) with schema-aware field pickers.
- Trigger mapping expressions evaluate with an `event` root (the full incoming event). The source payload is available at `event.payload` and is typed from the trigger’s source schema ref. The workflow payload root variable (`payload`) continues to refer to the workflow payload inside normal workflow steps.
- Validation messaging should explicitly mention:
  - Missing/unknown source schema ref
  - Mismatch requiring mapping
  - Mapping gaps (missing required fields) and expression errors

## Requirements

### Functional Requirements
- Event ingestion resolves a `sourcePayloadSchemaRef` with precedence:
  1) event submission payloadSchemaRef, 2) event catalog payload_schema_ref, 3) unknown (validation error).
- If event submission provides a schemaRef that differs from the event catalog, **accept the event** and record a **warning** (and telemetry) indicating the conflict; submission schemaRef still wins precedence.
- Workflows can optionally define a trigger-level mapping from source payload → workflow payload.
- “No mapping” is valid when schema refs match; execution uses source payload as workflow payload.
- When schema refs match, trigger mapping remains optional; if provided, it is applied and validated like any other mapping.
- When refs differ, mapping is required for execution and is validated deeply (including nested required fields).
- Missing secrets referenced by trigger mapping are validation **errors**.
- Validation details are persisted and shown in the designer.
- Run dialog can build a source-payload form from the trigger’s source schema ref, then run with mapping applied.
- Trigger mapping expressions must use `event` as the root variable; the incoming payload is accessed via `event.payload` (no `payload` alias in the trigger mapping context to avoid confusion with workflow payload).

### Non-functional Requirements
- Mapping evaluation and schema validation must be deterministic and auditable (store schemaRef + mapping provenance on run/events).
- Avoid runtime surprises: if mapping is required and invalid, the workflow does not start.

## Data / API / Integrations
- Add `payload_schema_ref` to workflow runtime event records (v2) so events retain source schema provenance.
- Extend workflow trigger shape to include optional `sourcePayloadSchemaRef` override and optional `payloadMapping`.
- Expose `payload_schema_ref` in workflow event list APIs so UI can show it.

## Security / Permissions
- Creating/editing trigger mapping requires workflow `manage` permission.
- Viewing schema refs and mapping details requires workflow `read` (consistent with existing behavior).

## Observability
- Audit log for publish/save already exists; extend run/event metadata to include:
  - sourcePayloadSchemaRef used
  - whether mapping was applied
  - catalog-vs-submission schemaRef conflict warning (when present)
  - validation failures preventing start (for debugging)

## Rollout / Migration
- DB migration to add `payload_schema_ref` to workflow runtime events table (v2).
- Backfill is not required; existing events can have null source schemaRef.
- Existing system event catalog entries should include `payload_schema_ref` going forward (inbound email already does).

## Open Questions
- Trigger mapping root variable name: **`event`** (resolved). Steps continue to use `payload` for the workflow payload; trigger mapping uses `event.payload` for the source payload.
- If event submission provides a schemaRef that conflicts with event catalog: **accept and warn** (resolved). Submission wins precedence; record warning/telemetry for observability.
- If schemaRefs match, do we allow an optional mapping anyway? **Yes** (resolved). Mapping remains optional but is validated/applied when provided.

## Acceptance Criteria (Definition of Done)
- When trigger source schemaRef matches workflow payload schemaRef, a workflow with no trigger mapping is valid and runnable.
- When source schemaRef differs, publish fails without trigger mapping; draft can save but is invalid for execution.
- Event-triggered runs apply trigger mapping (when present) and validate the resulting payload against workflow payloadSchemaRef.
- Workflow event list/run views show the source schemaRef used and whether mapping was applied.
- Designer clearly communicates whether mapping is required and guides users to fix invalid states.
