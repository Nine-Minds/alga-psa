# Scratchpad — Workflow Designer Grouped Palette, Inline Action Inputs, and Transform Actions

- Plan slug: `workflow-designer-grouped-palette-inline-inputs-transform-actions`
- Created: `2026-03-13`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also update earlier notes when a decision changes.

## Decisions

- (2026-03-13) Keep runtime execution on `action.call` in v1. The grouped palette and grouped-step model are designer abstractions, not a runtime contract rewrite.
- (2026-03-13) Replace the per-action palette with a hybrid grouped palette: built-in domain-object tiles plus app/plugin tiles.
- (2026-03-13) Replace the action input mapping dialog with an inline field-based editor in the right-side properties panel.
- (2026-03-13) Keep `config.inputMapping` as the persisted action-input model in v1.
- (2026-03-13) Support both fixed picker values and dynamic references for picker-backed fields.
- (2026-03-13) Limit typed picker coverage in the first pass to ticket-core identifiers.
- (2026-03-13) Treat common text/value/object shaping as first-class `Transform` actions rather than growing the expression surface.
- (2026-03-13) Keep expressions and secrets available only as advanced fallbacks.
- (2026-03-13) Implement the first grouped-catalog slice as a shared builder plus a separate server projection instead of mutating the runtime action registry shape. This keeps the runtime registry unchanged while giving the designer a stable authoring abstraction to build on.
- (2026-03-13) Keep the first UI wiring incremental: load the grouped catalog into the designer and use it to derive business-action grouping metadata before replacing the palette with grouped tiles. This reduces risk while moving the data model to the new architecture.
- (2026-03-13) Land transform actions incrementally through the runtime action registry first, starting with the text-shaping slice. That unlocks grouped-catalog search and downstream schema wiring without coupling the first runtime batch to the upcoming inline-editor refactor.

## Discoveries / Constraints

- (2026-03-13) The current workflow designer already uses `action.call` as the execution primitive and injects `actionId`/`version` when action-specific palette items are dragged onto the canvas.
- (2026-03-13) The current palette is constructed directly from the action registry plus designer-side curation in `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`.
- (2026-03-13) The current action-input UX already derives field lists from action schemas, but hides authoring behind an `Input Mapping` dialog.
- (2026-03-13) The current runtime `InputMapping` contract supports expressions, secrets, and literal values and resolves them in `shared/workflow/runtime/utils/mappingResolver.ts`.
- (2026-03-13) The current designer already maintains schema-driven data context for payload, prior step outputs, metadata, error context, and forEach context.
- (2026-03-13) The current designer already has mapping/type-compatibility UI primitives and expression-editor autocomplete infrastructure that should be reused where possible.
- (2026-03-13) Action schema export currently includes generic JSON Schema information, but does not yet carry workflow-specific picker metadata.
- (2026-03-13) Existing reusable UI components already exist for `BoardPicker`, `ClientPicker`, `ContactPicker`, `SearchableSelect`, `UserPicker`, and related selector patterns.
- (2026-03-13) The current expression runtime is already a constrained JSONata surface. Expanding it further would worsen the “mini-language” problem the user wants to avoid.
- (2026-03-13) Existing legacy workflows must remain editable without requiring migration because the same persisted step contract should continue to load.
- (2026-03-13) `listWorkflowRegistryActionsAction` is consumed by more than the designer, so adding grouped catalog metadata directly onto each runtime action payload would couple unrelated consumers; a dedicated `listWorkflowDesignerActionCatalogAction` is the safer seam.
- (2026-03-13) The designer’s existing palette curation was duplicated locally via module-to-category heuristics. Replacing that heuristic with catalog-derived grouping removes one source of drift before the grouped-tile UI lands.
- (2026-03-13) Grouped palette search was still doing raw substring matches against joined text. Hyphenated, dotted, underscored, and singular/plural queries were only matching incidentally, so the search slice needed explicit normalization rather than more ad hoc field concatenation.
- (2026-03-13) The Playwright tenant bootstrap failure is still present on this branch. Search- and palette-focused browser tests abort in `tenant-creation.ts` before the workflow designer loads, so browser checklist items remain blocked even when the underlying UI code is in place.
- (2026-03-13) The shared designer catalog helper had a local JSON-schema type that was narrower than the action registry payloads (notably tuple-style `items` and metadata-rich definitions). The search slice widened that helper type so EE TypeScript checks can validate the designer path against real action schemas.
- (2026-03-13) Grouped palette insertion was still throwing away authoring scope once a tile became an `action.call` step. Without additive metadata, grouped drag/click insertion and legacy hydration both had to fall back to action-only guesses.
- (2026-03-13) The grouped `Transform` tile already participated in palette rendering, drag/click insertion, and grouped-step hydration; the missing piece was simply that no `transform.*` runtime actions existed yet, so the tile remained effectively empty for search and future action dropdowns.

## Commands / Runbooks

- (2026-03-13) Read planning templates:
  - `sed -n '1,220p' /Users/roberisaacs/.codex/skills/alga-plan/assets/PRD_TEMPLATE.md`
  - `sed -n '1,220p' /Users/roberisaacs/.codex/skills/alga-plan/assets/SCRATCHPAD_TEMPLATE.md`
  - `sed -n '1,260p' /Users/roberisaacs/.codex/skills/alga-plan/references/plan_format.md`
- (2026-03-13) Inspect comparable workflow plan:
  - `sed -n '1,260p' ee/docs/plans/2025-12-27-workflow-trigger-payload-mapping/PRD.md`
  - `sed -n '1,220p' ee/docs/plans/2025-12-27-workflow-trigger-payload-mapping/features.json`
  - `sed -n '1,220p' ee/docs/plans/2025-12-27-workflow-trigger-payload-mapping/tests.json`
- (2026-03-13) Scaffold initial plan folder:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Workflow Designer Grouped Palette, Inline Action Inputs, and Transform Actions" --slug workflow-designer-grouped-palette-inline-inputs-transform-actions`
- (2026-03-13) Correct scaffolded date-prefixed folder to session date:
  - `mv ee/docs/plans/2026-03-12-workflow-designer-grouped-palette-inline-inputs-transform-actions ee/docs/plans/2026-03-13-workflow-designer-grouped-palette-inline-inputs-transform-actions`
- (2026-03-13) Validate the new shared catalog builder:
  - `pnpm vitest run --config shared/vitest.config.ts shared/workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts --reporter=dot`
- (2026-03-13) Validate the new server-side grouped catalog projection:
  - `cd server && npx vitest run src/test/integration/workflowRuntimeV2.publish.integration.test.ts --config vitest.config.ts --testNamePattern="T020: workflow designer receives the grouped catalog projection from the server action" --reporter=dot`
- (2026-03-13) Lint touched files after the catalog/projection slice:
  - `npx eslint shared/workflow/runtime/designer/actionCatalog.ts shared/workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts ee/server/src/components/workflow-designer/WorkflowDesigner.tsx server/src/app/api/workflow/registry/designer-catalog/route.ts server/src/test/integration/workflowRuntimeV2.publish.integration.test.ts`
- (2026-03-13) Attempt grouped-palette Playwright validation:
  - `npx playwright test ee/server/src/__tests__/integration/workflow-designer-basic.playwright.test.ts -g "palette renders grouped business tiles instead of one tile per business action|control blocks still render as dedicated palette entries alongside grouped tiles|transform renders as a top-level palette tile"`
- (2026-03-13) Validate grouped palette search helper:
  - `cd ee/server && npx vitest run --config vitest.config.ts src/components/workflow-designer/__tests__/paletteSearch.test.ts`
- (2026-03-13) Re-attempt grouped palette/search Playwright coverage:
  - `npx playwright test ee/server/src/__tests__/integration/workflow-designer-basic.playwright.test.ts -g "palette search filters nodes and restores list|palette search filters nodes by id|palette renders grouped business tiles instead of one tile per business action|control blocks still render as dedicated palette entries alongside grouped tiles|transform renders as a top-level palette tile"`
- (2026-03-13) Re-run shared catalog tests after widening schema typing:
  - `pnpm vitest run --config shared/vitest.config.ts shared/workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts --reporter=dot`
- (2026-03-13) Verify the EE server TypeScript surface:
  - `npx tsc --noEmit -p ee/server/tsconfig.json`
- (2026-03-13) Validate grouped action step helpers:
  - `cd ee/server && npx vitest run --config vitest.config.ts src/components/workflow-designer/__tests__/groupedActionStep.test.ts src/components/workflow-designer/__tests__/paletteSearch.test.ts`
- (2026-03-13) Validate text transform action registration and catalog/search coverage:
  - `pnpm vitest run --config shared/vitest.config.ts shared/workflow/runtime/actions/__tests__/registerTransformActions.test.ts shared/workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts --reporter=dot`
  - `cd ee/server && npx vitest run --config vitest.config.ts src/components/workflow-designer/__tests__/paletteSearch.test.ts --reporter=dot`
  - `cd server && npx vitest run src/test/integration/workflowRuntimeV2.publish.integration.test.ts --config vitest.config.ts --testNamePattern="T020: workflow designer receives the grouped catalog projection from the server action|Transform actions are exposed through the runtime action registry projection" --reporter=dot`
  - `npx eslint shared/workflow/runtime/actions/registerTransformActions.ts shared/workflow/runtime/actions/__tests__/registerTransformActions.test.ts shared/workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts ee/server/src/components/workflow-designer/__tests__/paletteSearch.test.ts server/src/test/integration/workflowRuntimeV2.publish.integration.test.ts shared/workflow/runtime/init.ts`
- (2026-03-13) Extend transform runtime coverage to object/value/array actions:
  - `pnpm vitest run --config shared/vitest.config.ts shared/workflow/runtime/actions/__tests__/registerTransformActions.test.ts --reporter=dot`
  - `npx eslint shared/workflow/runtime/actions/registerTransformActions.ts shared/workflow/runtime/actions/__tests__/registerTransformActions.test.ts`

## Links / References

- Designer entrypoint: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`
- Mapping editor: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/server/src/components/workflow-designer/mapping/InputMappingEditor.tsx`
- Mapping panel: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/server/src/components/workflow-designer/mapping/MappingPanel.tsx`
- Source tree: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/server/src/components/workflow-designer/mapping/SourceDataTree.tsx`
- Runtime action registry: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/shared/workflow/runtime/registries/actionRegistry.ts`
- Grouped catalog builder: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/shared/workflow/runtime/designer/actionCatalog.ts`
- Grouped catalog builder test: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/shared/workflow/runtime/__tests__/workflowDesignerActionCatalog.test.ts`
- Grouped catalog server action: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts`
- Grouped catalog API route: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/server/src/app/api/workflow/registry/designer-catalog/route.ts`
- Runtime mapping types: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/shared/workflow/runtime/types.ts`
- Mapping resolver: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/shared/workflow/runtime/utils/mappingResolver.ts`
- Mapping validator: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/shared/workflow/runtime/validation/mappingValidator.ts`
- Ticket actions: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/shared/workflow/runtime/actions/businessOperations/tickets.ts`
- Contact actions: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/shared/workflow/runtime/actions/businessOperations/contacts.ts`
- Expression engine: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/shared/workflow/runtime/expressionEngine.ts`
- Expression function docs: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/ee/server/src/components/workflow-designer/expression-editor/functionDefinitions.ts`
- Board picker: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/packages/ui/src/components/settings/general/BoardPicker.tsx`
- Client picker: `/Users/roberisaacs/alga-psa.worktrees/refactor/workflow-previous-action-ref/packages/ui/src/components/ClientPicker.tsx`

## Open Questions

- Should app tiles ever expose a second-level object selector inside the step, or should the first version insist on a single filtered action dropdown per app tile?
- Which transform actions should be considered mandatory for v1 versus follow-on work, especially around array/object shaping?
- Whether import/export surfaces need explicit grouped-tile metadata or whether actionId-derived hydration is sufficient for v1.

## Progress Log

- (2026-03-13) Completed the first grouped-catalog slice:
  - Added shared grouped designer catalog types and builder covering built-in core-object records, a stable transform record, and inferred app records.
  - Added `listWorkflowDesignerActionCatalogAction` plus `/api/workflow/registry/designer-catalog`.
  - Switched `WorkflowDesigner.tsx` off the local module-category heuristic and onto loaded catalog metadata for business-action grouping.
  - Added unit coverage for catalog construction and integration coverage for the new server projection.
- (2026-03-13) Completed the grouped palette rendering slice:
  - Replaced per-action business palette entries with grouped `Core`, `Transform`, and `Apps` tiles sourced from the designer catalog.
  - Preserved control blocks and generic nodes, added grouped tile test ids/ids, and disabled drag/click interactions in read-only or registry-error states.
  - Kept grouped tile click and drag insertion flows working by mapping grouped tiles back to `action.call` steps with default actions when available.
- (2026-03-13) Completed the grouped palette search normalization slice:
  - Added a dedicated palette-search helper that normalizes label/id/description/schema text across spaces, dots, dashes, and underscores.
  - Added singular/plural token variants so grouped tiles match natural object-name queries and verb-object phrases without duplicating tiles.
  - Reused the helper for stable grouped ordering so empty-state and filtered results keep the same category ordering.
  - Marked F041-F048, F050-F053, and F056-F060 implemented; F049 remains blocked until first-class transform actions exist and F054/F055 still need browser validation once tenant bootstrap is fixed.
- (2026-03-13) Completed the grouped action metadata slice:
  - Added a grouped-action-step helper that persists additive designer scope (`designerGroupKey`, `designerTileKind`, and `designerAppKey`) without changing the runtime `action.call` contract.
  - Wired grouped drag/click insertion through that helper so grouped tiles can create `action.call` steps even when no default action is selected yet.
  - Added grouped-step hydration helpers so legacy `action.call` steps can recover their grouped catalog record from `actionId` when metadata is absent.
  - Marked F061-F066 and F069-F075 implemented; selection/reordering browser checks remain pending behind the tenant bootstrap blocker.
- (2026-03-13) Completed the first transform runtime slice:
  - Added first-class `transform.*` runtime actions for truncate, concat, replace, split, join, lowercase, uppercase, and trim, each with explicit input/output schemas and deterministic pure handlers.
  - Wired the runtime initializer to register transform actions so the grouped `Transform` catalog record now exposes contained actions to server projections and designer search.
  - Extended catalog/search coverage so `truncate-text`-style queries now match the grouped `Transform` tile through contained action metadata rather than a hidden action row.
  - Marked F049, F226-F229, F241-F258, and T226-T228/T251-T258 implemented.
- (2026-03-13) Extended transform runtime coverage beyond text shaping:
  - Added first-class `transform.coalesce_value`, `transform.build_object`, `transform.pick_fields`, `transform.rename_fields`, `transform.append_array`, and `transform.build_array` actions with explicit schemas and deterministic pure handlers.
  - Added unit coverage for representative coalesce/object/array behavior plus schema assertions for coalesce and array outputs.
  - Marked F261-F268, F272-F273, and T268/T272-T273 implemented.
- (2026-03-13) Validation blocker:
  - The new grouped-palette Playwright tests could not complete because tenant bootstrap failed before the browser reached the designer (`Failed to create tenant` from `tenant-creation.ts`). The assertions themselves did not run, so `tests.json` remains unchanged for the new palette tests.
- (2026-03-13) Validation update:
  - `paletteSearch.test.ts` passed under EE Vitest, covering normalized grouped search semantics plus stable grouped ordering (T052).
  - The shared catalog unit suite still passes after widening the internal schema helper type used by the grouped designer catalog.
  - `npx tsc --noEmit -p ee/server/tsconfig.json` now completes successfully after the schema-type widening.
  - `groupedActionStep.test.ts` passed under EE Vitest, covering runtime-compatible grouped-step metadata plus legacy group/app hydration (T069-T075).
  - Targeted Playwright search/palette tests still fail before assertions because tenant creation aborts with the same `Failed to create tenant` error from `ee/server/src/lib/testing/tenant-creation.ts`.
  - The new transform-action shared unit suite passed, covering registry presence, explicit schemas, typed output fields, and representative text-transform behavior.
  - The existing server registry/catalog integration suite passed after extending it to assert that grouped catalog projection and runtime action projection now include `transform.truncate_text`.
  - ESLint on the touched files passed with only pre-existing warnings in `server/src/test/integration/workflowRuntimeV2.publish.integration.test.ts`.
  - An attempted DB-backed integration expansion for text transform execution was reverted because the local `server` test database was unavailable in this worktree (`error: database "server" does not exist`), so text-transform runtime behavior remains covered through shared unit tests for now.
