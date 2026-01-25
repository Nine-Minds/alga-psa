# Scratchpad — Workflow Import/Export (2026-01-25)

## Context
- Workflow Runtime V2 stores:
  - `workflow_definitions` (draft + metadata)
  - `workflow_definition_versions` (published immutable versions)
- Existing test helpers exist under `server/src/test/helpers/workflowRuntimeV2TestHelpers.ts`.

## Decisions (draft)
- Use a JSON **bundle** format with explicit `format` + `formatVersion`.
- V1 accepts exactly one version and rejects others (no migration/back-compat).
- “Full fidelity” targets workflow behavior + operational settings, not audit timestamps.
- Bundle requires a stable portable `key` per workflow (distinct from DB ids).
- Import always regenerates `workflow_id`.
- Import is create-only by default; `--force` / `force=true` overwrites by deleting the existing workflow (matched by key) and recreating it from the bundle.
- V1 is API-only plus a CLI wrapper in `tools/` (no UI).

## Proposed docs locations
- `ee/docs/schemas/workflow-bundle.v1.schema.json`
- `ee/docs/guides/workflows/workflow-import-export.md`

## Open Questions to resolve
1. Do we need additional explicit validation beyond DB constraints for specific reference types (if constraints are insufficient)?

## Notes / references
- Workflow Runtime V2 PRD: `ee/docs/plans/2025-12-21-workflow-overhaul.md`
- Persistence models:
  - `shared/workflow/persistence/workflowDefinitionModelV2.ts`
  - `shared/workflow/persistence/workflowDefinitionVersionModelV2.ts`

## Work log
- 2026-01-25: Added v1 bundle header constants/types in `shared/workflow/bundle/workflowBundleV1.ts` (`format`, `formatVersion`, `exportedAt`) to centralize the accepted format/version.
- 2026-01-25: Defined v1 bundle TypeScript shape (workflow metadata + draft + published versions) in `shared/workflow/bundle/workflowBundleV1.ts` as the shared contract for exporter/importer/tests.
- 2026-01-25: Standardized portable workflow identifier as `workflows[].key` with a basic validation pattern in `shared/workflow/bundle/workflowBundleV1.ts`.
- 2026-01-25: Added canonical JSON rules implementation in `shared/workflow/bundle/canonicalJson.ts` (recursive key sort, 2-space indent, trailing newline) for stable bundle bytes.
- 2026-01-25: Added JSON Schema `ee/docs/schemas/workflow-bundle.v1.schema.json` (draft-07) as the machine-checkable contract for v1 bundles.
- 2026-01-25: Added human-readable format spec at `ee/docs/guides/workflows/workflow-import-export.md` (header, key semantics, canonical JSON, import policies).
- 2026-01-25: Added `workflow_definitions.key` (nullable, unique) via `server/migrations/20260125120000_add_workflow_definition_key.cjs` to support portable bundle identity and create/overwrite semantics. Backfills the seeded email workflow to `system.email-processing`.
- 2026-01-25: Implemented single-workflow exporter `server/src/lib/workflow/bundle/exportWorkflowBundleV1.ts` (loads workflow_definitions + workflow_definition_versions into the v1 bundle shape).
- 2026-01-25: Extended exporter to support multi-workflow bundles via `exportWorkflowBundleV1ForWorkflowIds` (bulk-load definitions + versions; workflows sorted by key).
- 2026-01-25: Exporter intentionally omits instance-specific audit/actor fields (timestamps, *_by, version_id) by projecting only the portable subset into the bundle.
- 2026-01-25: Exporter includes operational settings in `metadata` (isPaused/isVisible/concurrency/retention/auto-pause thresholds) for behavioral fidelity.
- 2026-01-25: Added dependency summary collection (`shared/workflow/bundle/dependencySummaryV1.ts`) and included `dependencies` in bundle exports (actions/node types/schema refs) to support structured missing-dependency errors on import.
- 2026-01-25: Added import-time header validation for v1 bundles in `server/src/lib/workflow/bundle/validateWorkflowBundleHeaderV1.ts` (rejects unsupported formatVersion with a structured error).
- 2026-01-25: Added Ajv-based bundle schema validation using `ee/docs/schemas/workflow-bundle.v1.schema.json` via `server/src/lib/workflow/bundle/validateWorkflowBundleSchemaV1.ts`.
- 2026-01-25: Added dependency validation helper `server/src/lib/workflow/bundle/validateWorkflowBundleDependenciesV1.ts` that checks bundle-declared actions/nodeTypes/schemaRefs against runtime registries and throws structured missing-dependency errors.
- 2026-01-25: Implemented bundle importer core in `server/src/lib/workflow/bundle/importWorkflowBundleV1.ts` using a single `knex.transaction(...)` for all writes (rolls back on any error).
