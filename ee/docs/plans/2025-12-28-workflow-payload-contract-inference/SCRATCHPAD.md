# Scratchpad — Workflow Payload Contract Inference

Rolling implementation notes (append; prune as needed).

## 2025-12-28
- Decision: pinning is unrestricted (no extra governance permission).
- Contract schemas: start with payload-only snapshots (no embedding `event/vars`).
- Effective schema UI can be shown as JSON preview; no virtual schemaRef needed.
- Custom events policy left flexible (may be removed); avoid extra work.

### Implemented slice (mode + persistence + UI)
- Added `payload_schema_mode`, `pinned_payload_schema_ref`, `payload_schema_provenance` to `workflow_definitions`.
  - Migration: `server/migrations/20251228193000_add_workflow_payload_schema_mode.cjs`
- Extended workflow draft save/create APIs to persist mode + pinned ref:
  - `server/src/lib/actions/workflow-runtime-v2-schemas.ts`
  - `server/src/lib/actions/workflow-runtime-v2-actions.ts`
- Updated designer to present “Workflow data contract” with a “Pin schema (advanced)” toggle and to persist mode.
  - `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`

### Notes
- Current runtime uses `payload_schema_json` snapshots stored on `workflow_definition_versions` on publish; execution does not depend on schema registry at runtime.
- For now, inferred mode sets `payloadSchemaRef` to the trigger’s inferred schemaRef (from event catalog) and publishes a snapshot of that schema JSON for stability.

### Follow-up (publish-time behavior + UX)
- Publish action now re-infers `definition.payloadSchemaRef` in inferred mode from the trigger’s source schemaRef at publish time (override or event catalog).
- Designer shows a warning if inferred contract differs from the published contract and offers “Pin to published contract”.

### 2025-12-28 (cont.)
- Added deterministic payload schema snapshot hashing via stable JSON key ordering in validation/publish.
  - `server/src/lib/actions/workflow-runtime-v2-actions.ts`
- Added in-memory caching for schema registry `toJsonSchema()` + `listRefs()` to reduce repeated Zod→JSON conversions in designer/run dialogs.
  - `shared/workflow/runtime/registries/schemaRegistry.ts`
- Allowed opening the Run dialog for draft (unpublished) workflows for preview; running remains disabled until a version is published.
  - `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
  - `ee/server/src/components/workflow-designer/WorkflowRunDialog.tsx`
