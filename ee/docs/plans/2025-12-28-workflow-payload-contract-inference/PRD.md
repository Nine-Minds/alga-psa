# PRD — Draft-Time Payload Inference + Publish-Time Payload Contract

- Slug: `workflow-payload-contract-inference`
- Date: `2025-12-28`
- Status: Draft
- Depends on:
  - `ee/docs/plans/2025-12-21-workflow-overhaul.md`
  - `ee/docs/plans/2025-12-27-workflow-trigger-payload-mapping/PRD.md`

## Summary
Business owners should be able to start building an automation by selecting an event trigger and adding steps, without having to fully specify the workflow payload schema up front. This plan makes the workflow payload schema a **publish-time contract** while enabling a rich, typed design-time experience via an **effective schema** computed from the trigger + step outputs.

Published workflows still have a stable `payloadSchemaRef` contract that remains stable across trigger schema changes.

## Problem
Today, the workflow designer expects a workflow `payloadSchemaRef` to be specified early (and users can be asked to type schema ref strings). In practice, business owners typically do not know the final “shape” of the workflow payload before they build the steps. This creates friction and leads to incorrect / arbitrary schema choices that harm validation and mapping UX.

## Goals
- Keep the invariant: **Published workflow payload is stable** via `payloadSchemaRef`.
- Allow creating and editing **draft** workflows without explicitly selecting a workflow payload schema ref.
- Maintain a strong design-time experience (field picking, autocomplete, mapping, validation) using an **effective payload schema** that is inferred from:
  - trigger event payload schema (`event.payload`)
  - step outputs (`vars.*`) derived from registries
- Preserve and extend the trigger payload mapping policy:
  - If trigger source schemaRef matches workflow payload schemaRef, “no mapping” is valid.
  - Conflicts accept + warn; missing secrets are errors; missing schemas for system events are errors.
- Generate a **publish-time payload contract schema** automatically (or allow pinning for advanced users).

## Non-goals
- Perfect whole-program type inference across arbitrary expressions (we’ll prefer “known where possible; unknown where not”).
- Auto-migrating existing workflows to new schemas (explicit mapping is still the mechanism).
- Supporting “structural compatibility” between schema refs without explicit mapping.

## Users and Primary Flows
### Users
- Business owner / automation builder
- MSP admin
- Support/engineering (debugging and governance)

### Primary flows
1. **Create workflow from event**
   - Choose event trigger (must have known schema for system events).
   - Start adding steps immediately.
   - Designer shows available fields from `event.payload` and from `vars.*` as steps are added.
2. **Publish workflow**
   - System generates/locks the payload contract schema ref if not pinned.
   - Validator enforces execution requirements (mapping, secrets, schema presence).
3. **Run workflow (test run)**
   - Run dialog uses trigger schema to build event payload input.
   - Trigger mapping (if present) produces workflow payload; run executes using the published payload contract.
4. **Schema evolution**
   - Trigger schema changes do not change published payload contract.
   - Workflows remain runnable when required mappings exist and validate.

## UX / UI Notes
### Workflow Designer — Trigger
- Trigger event is selected from the event catalog (not typed).
- Under the trigger selector, show:
  - event schema ref (required; status badge)
  - “View schema” link/modal
- If event schema is missing/unknown:
  - show error banner and disable publish/run (system events: cannot select; tenant events: selectable but cannot publish/run).

### Workflow Designer — Workflow Payload Contract
- Replace the current “Payload schema” requirement with a contract section:
  - Default: “Contract will be generated on publish.”
  - Advanced: “Pin payload schema ref” (optional; power users)
- Schema preview / modal shows:
  - “Effective schema (design time)” when inferred
  - “Pinned contract schema” when pinned
  - “Published contract schema” when viewing published versions

### Field Picker / Mapping / Expressions
- The “available data” palette is driven by an **effective data context**:
  - `event.payload` typed from trigger source schema
  - `vars.<saveAs>` typed from registry output schemas
  - (Optionally) `payload` typed from effective payload schema (inferred or pinned)
- If something is unknown, label it as “Unknown type” and degrade type-compat validation to warnings for that segment.

## Requirements

### Design-Time Behavior (Drafts)
- Draft workflows can be created/saved with no explicit `payloadSchemaRef`.
- The designer computes an **effective payload schema** used for:
  - mapping UI field options
  - expression autocomplete contexts
  - type compatibility checks (where type info exists)
- Effective payload schema sources:
  1) pinned payload schema ref (advanced)
  2) inferred payload schema derived from trigger + step outputs
- If the trigger is an event, trigger source schema inference must come from:
  - event submission schemaRef (if provided) OR
  - event catalog schemaRef (required for system events; required for tenant events under current policy)

### Publish-Time Behavior (Contract)
- When publishing, a workflow must end up with a stable `payloadSchemaRef`:
  - if pinned: use pinned ref
  - if not pinned: **generate and register** a payload schema snapshot and set it as the published `payloadSchemaRef`
- Publishing must validate:
  - trigger schema presence policy (system events cannot publish without known schema)
  - mapping requirements (trigger→payload mapping required when schema refs differ)
  - missing secrets referenced by mappings/expressions are errors
  - deep nested required fields for mappings
- After publish, the workflow payload contract is stable and used for runs.

### Type Compatibility
- Validator should treat type mismatches as:
  - **errors** when both source and target types are known and incompatible
  - **warnings** when types are unknown (e.g., unknown step output schema)

## Data Model / API / Integrations
- Draft-level payload schema fields:
  - Add an explicit `payloadSchemaMode` (or equivalent) to distinguish:
    - `inferred` (default)
    - `pinned` (advanced)
- Published versions must store:
  - `payload_schema_ref` (contract)
  - provenance: pinned vs generated
  - generated schema ref naming convention: `workflow.<workflowId>.payload.v<version>`
- Schema registry must accept generated payload schemas and expose them via existing schema APIs.

## Security / Permissions
- Only users with `workflow:manage` can pin payload schema refs and edit mappings/steps.
- Only users with `workflow:publish` can publish contracts.
- Tenant context is inferred from the authenticated session; tenant must not be exposed in simulation/test event builders.

## Observability
- Emit telemetry/audit for:
  - publish generated payload schema ref (and version)
  - publish blocked due to missing trigger schema/mapping/secrets
  - trigger schema conflicts (submission vs catalog)
  - inferred vs pinned mode

## Rollout / Migration
- DB migrations:
  - allow draft workflows to have null/empty payload schema ref where needed
  - add any new metadata fields required for `payloadSchemaMode` and contract provenance
- Existing published workflows remain unchanged; existing drafts may remain with explicit payloadSchemaRef.

## Open Questions
1. Should “pin payload schema ref” be available to all manage users, or restricted behind a governance permission?
2. Should generated payload schema snapshots include only `payload` (contract) or also embed `event/vars` for debugging?
3. Should “effective schema” be shown as a schema ref (virtual) or only as a preview (JSON) in the UI?
4. For tenant-defined events, do we ever allow saving a custom event without schema in a “draft” event state? (Current policy: require schemas; missing schema is error.)

## Acceptance Criteria (Definition of Done)
- Users can create a workflow from an event and add steps without selecting a workflow payload schema ref.
- Designer provides a usable field picker/autocomplete experience based on trigger schema + step outputs.
- Publishing a workflow without a pinned schema generates and stores a stable payload contract schema ref.
- Published workflows remain stable across trigger schema changes; execution uses trigger mapping when needed.
- Missing trigger schema (system events), missing required mapping, and missing secrets block publish/run with clear validation errors.

