# PRD: Complete OpenAPI Documentation Coverage

## Status

Draft created 2026-04-24.

## Problem Statement

The generated Alga PSA OpenAPI specs still contain hundreds of route-inventory placeholder operations. Placeholder operations have generic summaries/descriptions, empty request/response schemas, incomplete auth information, and no source-grounded notes about tenant scoping, ID provenance, current implementation gaps, or status-code behavior.

This limits SDK generation, API discoverability, integration accuracy, AI/tool-call grounding, and QA confidence. The ongoing work has already replaced placeholders for the first 80 operations. The remaining work needs a durable, testable plan so future batches can continue consistently.

## User Value

- API consumers can understand required inputs, output envelopes, auth requirements, tenant behavior, and failure modes without reading source.
- Generated SDK/docs become safer to use because route metadata is canonical instead of inventory-derived.
- Internal agents and tooling can reason about API capabilities using accurate OpenAPI descriptions.
- Future maintainers can continue the batch process without losing context or repeating investigation work.

## Goals

1. Replace all remaining generated placeholder OpenAPI operations in CE and EE specs with source-grounded canonical metadata.
2. Maintain the established batch workflow: investigate 5 operations at a time, update registrars, regenerate CE/EE specs, validate, update progress, commit/push periodically.
3. Document for each operation:
   - Summary and detailed description.
   - Path/query/header/body schemas and required fields.
   - Response schemas and status codes.
   - Auth/security requirements.
   - Tenant scoping and RBAC behavior.
   - ID provenance and table/column origins where applicable.
   - Known implementation gaps when source behavior differs from intended API behavior.
4. Keep generated specs synchronized:
   - `sdk/docs/openapi/alga-openapi.ce.json`
   - `sdk/docs/openapi/alga-openapi.ce.yaml`
   - `sdk/docs/openapi/alga-openapi.ee.json`
   - `sdk/docs/openapi/alga-openapi.ee.yaml`
   - `sdk/docs/openapi/alga-openapi.json`
   - `sdk/docs/openapi/alga-openapi.yaml`
5. Preserve existing local-only user changes, especially `.env.localtest`.

## Non-Goals

- Do not fix runtime route bugs discovered during documentation, unless separately requested.
- Do not redesign auth, RBAC, or response envelopes.
- Do not convert all controllers to a new API framework.
- Do not create exhaustive endpoint-level integration tests for every route as part of this documentation pass.
- Do not modify `.env.localtest`.

## Target Users / Personas

- External API integrators using OpenAPI docs or generated SDKs.
- Alga engineers maintaining API controllers and route registrars.
- AI/chat/tool-call systems consuming API registry metadata.
- QA/release engineers validating that API docs match implemented behavior.

## Primary Workflow

1. Select next 5 unresolved placeholders from `sdk/docs/openapi/alga-openapi.ce.json`.
2. Launch 5 parallel investigator subagents with model `deepseek/deepseek-v4-pro` when available.
3. Investigator reports must be read-only and include route behavior, auth, params/body, responses, ID provenance, and source evidence.
4. Writer updates or creates route registrar files under `server/src/lib/api/openapi/routes/`.
5. Import any new registrar in `server/src/lib/api/openapi/index.ts` before inventory backfill.
6. Regenerate specs:
   - `npm --prefix sdk run openapi:generate`
   - `npm --prefix sdk run openapi:generate -- --edition ee`
7. Validate selected operations no longer contain placeholder descriptions or `x-placeholder` metadata.
8. Update `/tmp/alga-openapi-doc-progress.md` and this plan as needed.
9. Commit/push registrar and generated spec changes, excluding `.env.localtest`.

## Current Baseline

- Branch: `docs/api-docs-input-output`
- Worktree: `/Users/roberisaacs/alga-psa.worktrees/docs/api-docs-input-output`
- Last completed batch: Batch 16
- Latest pushed commit at plan creation: `e733631bf docs(openapi): document asset history and automation execution routes`
- Remaining CE placeholder count: 488
- Next selected batch: Batch 17

Batch 17:
1. `GET /api/v1/automation/performance`
2. `GET /api/v1/automation/rules`
3. `POST /api/v1/automation/rules`
4. `POST /api/v1/automation/rules/bulk-execute`
5. `POST /api/v1/automation/rules/bulk-status`

## Data Model / API Integration Notes

- Manual registrars override inventory backfill because they are registered before `registerInventoryBackfillRoutes`.
- Existing route registrars can use local Zod schemas or imported API schemas where reliable.
- Generated inventory placeholders are detected by either:
  - Description containing `generated automatically`, or
  - `extensions.x-placeholder` in generated OpenAPI.
- CE placeholder count is the primary cursor because CE contains the shared baseline; EE generation must still be validated.
- Some route inventory entries may point to missing route files. Document these as inventory-only/missing-handler routes rather than inventing behavior.

## Risks and Constraints

- Many controllers have current implementation gaps, especially old `/api/v1` routes with missing request context wiring. Document actual behavior and intended behavior clearly.
- Some existing schemas do not match actual controller output. Prefer actual source behavior over aspirational schemas.
- Generated OpenAPI diffs are large; keep commits batch-oriented and descriptive.
- DeepSeek/OpenRouter availability can fluctuate. If subagents fail, document the failure in scratchpad/progress and continue with local source investigation only if necessary.
- Do not stage or commit `.env.localtest`.

## Acceptance Criteria / Definition of Done

The remaining OpenAPI documentation work is complete when:

1. CE generated spec has zero operations with placeholder descriptions or `x-placeholder` metadata.
2. EE generated spec has zero operations with placeholder descriptions or `x-placeholder` metadata, except intentional EE-only omissions if justified in scratchpad.
3. Every formerly-placeholder route has source-grounded metadata for inputs, outputs, auth, tenant behavior, and relevant status codes.
4. All new route registrar files are imported in `server/src/lib/api/openapi/index.ts` before inventory backfill.
5. `npm --prefix sdk run openapi:generate` succeeds.
6. `npm --prefix sdk run openapi:generate -- --edition ee` succeeds.
7. `/tmp/alga-openapi-doc-progress.md` is current.
8. This plan's `features.json` and `tests.json` are updated to reflect completion.
9. Changes are committed and pushed, with `.env.localtest` left untouched.

## Open Questions

- Should discovered runtime defects be filed separately as issues, or only documented in OpenAPI descriptions/extensions?
- Should the final pass include a generated report of all route implementation gaps found during documentation?
- Should generated OpenAPI operation IDs be normalized across all newly documented routes, or left omitted unless already established?
