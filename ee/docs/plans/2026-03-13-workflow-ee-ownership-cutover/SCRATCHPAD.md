# Scratchpad — Workflow EE Ownership Cutover

- Plan slug: `workflow-ee-ownership-cutover`
- Created: `2026-03-13`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also update earlier notes when a decision changes.

## Decisions

- (2026-03-13) Treat workflow as EE-only, hard stop. The ownership cutover will move workflow into `@alga-psa/workflows` rather than leaving it in the global shared namespace.
- (2026-03-13) This is a hard-cut migration, not a shimmed transition. Application code and tests should stop importing `@shared/workflow*` and `@alga-psa/shared/workflow*`.
- (2026-03-13) The target home is the existing EE package at `ee/packages/workflows/src/*`.
- (2026-03-13) Workflow-owned stream and domain-event helper surfaces move with workflow rather than being split into a separate shared package in this change.
- (2026-03-13) The AI workflow step refactor is part of this broader ownership move, not a separate plan.

## Discoveries / Constraints

- (2026-03-13) `shared/workflow` is much wider than just the runtime; it includes actions, adapters, bundle, expression-authoring, persistence, runtime, secrets, services, streams, types, utilities, and workers.
- (2026-03-13) The current EE workflows package exists, but its build/export surface is narrow: package root plus `actions`, `components`, `forms`, `lib`, and `models`.
- (2026-03-13) `services/workflow-worker` currently imports runtime and workers from `@shared/workflow`.
- (2026-03-13) `ee/packages/workflows` still imports runtime, persistence, bundle, and catalog helpers from `@shared/workflow`.
- (2026-03-13) Many non-workflow packages currently import workflow-owned domain-event builders from `@shared/workflow/streams/...` or `@alga-psa/shared/workflow/streams/...`.
- (2026-03-13) Some server code outside the EE workflows package still initializes workflow runtime or uses workflow persistence helpers directly.
- (2026-03-13) The AI inference work introduced a concrete shared-to-EE leak: `shared/workflow/runtime/actions/registerAiActions.ts` imports the EE workflow inference service.
- (2026-03-13) The worker package already has a dependency alias for `@alga-psa/workflows`, so the package is the natural canonical surface for runtime ownership.
- (2026-03-13) The EE workflows package can cover the hard cut with category entrypoints (`runtime`, `workers`, `persistence`, `bundle`, `streams`, `expression-authoring`, `secrets`, `services`, `types`) instead of mirroring every legacy shared deep file one-for-one.
- (2026-03-13) Export-star collisions surfaced once the new EE barrels existed. The safe pattern here is: keep the root package barrel narrow, keep category barrels broad, and explicitly re-export only the extra runtime/stream symbols that are not already covered by the shared category index.
- (2026-03-13) `pnpm --filter @alga-psa/workflows build` and `pnpm --filter workflow-worker build` are partially blocked in this workspace because local CLIs like `tsup` and `tsc-alias` are not installed under `node_modules`; targeted TypeScript compilation still works.
- (2026-03-13) The remaining test-import cleanup was safer after adding deep EE proxy files for the legacy subpaths still used by tests (`runtime/*`, `persistence/*`, `streams/*`, `bundle/canonicalJson`, `actions/emailWorkflowActions`, `adapters/*`) rather than hand-rewriting every test to category-root imports.
- (2026-03-13) The stale `20250707201500_register_email_processing_workflow.cjs` bootstrap migration was pointing at a nonexistent legacy workflow module. Replacing it with an explicit placeholder throw is lower risk than preserving the broken dynamic import string because later migrations overwrite the DB-stored code anyway.
- (2026-03-13) The runtime publish contract now reports unknown workflow payload schema refs as `PAYLOAD_SCHEMA_REF_UNKNOWN` on `root.payloadSchemaRef`; older `UNKNOWN_SCHEMA` assertions were stale.
- (2026-03-13) `test.echo` is no longer a stable "missing required mapping" sentinel for publish validation. `test.actionProvided.key` is the reliable required-input case.
- (2026-03-13) `startWorkflowRunAction` still revalidates published versions when `validation_status` is missing or errored, but the forced-invalid coverage case must be definition-invalid (for example `unknown.node`) rather than relying on action-mapping ambiguity.
- (2026-03-13) The worker E2E harness had the same stale pre-cutover imports as the runtime suites. `workflowRuntimeV2.e2e.test.ts` needed to mock `@alga-psa/db` and `@alga-psa/auth`, ensure `tenant_workflow_schedule` exists, and insert a real tenant row so direct `event_catalog` writes satisfy FK constraints.
- (2026-03-13) The email workflow fixture used by worker E2E coverage predates trigger-payload mapping. To publish it through the canonical server action, the test seed now injects `sourcePayloadSchemaRef: payload.InboundEmailReceived.v1` plus an explicit mapping for `emailData`, `providerId`, and `tenantId`.
- (2026-03-13) The shared inbound-email workflow fixture is version `2`; stale E2E callers were still starting version `1`, which surfaced as `Workflow version not found` after the seed helper moved onto the real create/publish path.

## Commands / Runbooks

- (2026-03-13) Inventory workflow imports:
  - `rg -n "@shared/workflow|@alga-psa/shared/workflow|shared/workflow" . -g '!**/dist/**'`
- (2026-03-13) Inventory current EE workflows package surface:
  - `find ee/packages/workflows -maxdepth 2 -type f | sort`
  - `cat ee/packages/workflows/package.json`
  - `cat ee/packages/workflows/tsup.config.ts`
- (2026-03-13) Inventory workflow runtime bootstrap callers:
  - `rg -n "initializeWorkflowRuntimeV2\\(|WorkflowRuntimeV2Worker|WorkflowRuntimeV2EventStreamWorker" ee server services shared`
- (2026-03-13) Focused import-audit validation after implementation:
  - `rg -n "from '@shared/workflow|from '@alga-psa/shared/workflow" packages server services ee -g '!**/docs/**'`
- (2026-03-13) Suggested focused validation after implementation:
  - `pnpm --filter @alga-psa/workflows build`
  - `pnpm --filter workflow-worker typecheck`
  - `pnpm --filter server typecheck`
  - `pnpm --filter ee-server typecheck`
- (2026-03-13) Validation actually used for the first cutover tranche:
  - `pnpm --filter @alga-psa/workflows typecheck`
  - `pnpm --filter workflow-worker build`
  - `rg -n "@shared/workflow|@alga-psa/shared/workflow" packages server services ee -g '!**/docs/**' -g '!**/dist/**' -g '!**/__tests__/**' -g '!**/test/**' -g '!**/tests/**'`
- (2026-03-13) Validation used for the AI/test cutover tranche:
  - `pnpm --filter @alga-psa/workflows typecheck`
  - `pnpm --filter server typecheck`
  - `pnpm --filter sebastian-ee typecheck`
  - `pnpm --filter workflow-worker exec tsc -p tsconfig.json`
  - `rg -n "@shared/workflow|@alga-psa/shared/workflow" . -g '!**/docs/**' -g '!**/dist/**'`
  - `pnpm --filter server exec vitest run src/test/unit/workflowSchemaRegistry.unit.test.ts src/test/unit/email/inboundEmailBodyParsing.test.ts`
  - `pnpm --filter sebastian-ee exec vitest run src/components/workflow-designer/__tests__/workflowDataContext.test.ts`
- (2026-03-13) Validation used for the runtime compatibility tranche:
  - `pnpm --filter server exec vitest run src/test/integration/workflowRuntimeV2.publish.integration.test.ts`
  - `pnpm --filter server exec vitest run src/test/integration/workflowRuntimeV2.control.integration.test.ts`
  - `pnpm --filter server exec vitest run src/test/unit/workflowRuntimeV2.unit.test.ts`
- (2026-03-13) Validation used for the worker compatibility tranche:
  - `pnpm --filter server exec vitest run src/test/e2e/workflowRuntimeV2.e2e.test.ts -t "publish a workflow|event trigger starts workflow run|event.wait pauses run|timeout on event.wait|retryable action failure|idempotent action call|canceling a running workflow|resume a WAITING run"`

## Links / References

- EE workflows package root: [package.json](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/packages/workflows/package.json)
- EE workflows build config: [tsup.config.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/packages/workflows/tsup.config.ts)
- Shared runtime entrypoint: [index.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/index.ts)
- Shared runtime bootstrap: [init.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/init.ts)
- Workflow worker bootstrap: [index.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/services/workflow-worker/src/index.ts)
- Workflow worker event stream: [WorkflowRuntimeV2EventStreamWorker.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts)
- EE workflow server actions: [workflow-runtime-v2-actions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts)
- AI registration leak point: [registerAiActions.ts](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/shared/workflow/runtime/actions/registerAiActions.ts)
- AI workflow plan that triggered this cleanup: [PRD.md](/Users/roberisaacs/alga-psa.worktrees/feature/ai-support-workflow-steps/ee/docs/plans/2026-03-14-workflow-ai-inference-step/PRD.md)

## Open Questions

- None. The plan assumes full workflow ownership belongs in the EE workflows package and that workflow-owned helper surfaces move with it.

## Progress Log

- (2026-03-13) Completed F001/F002/F003/F004/F005/F006/F007/F008 in one tranche by adding EE workflow category entrypoints, expanding package exports/build entries, shifting runtime bootstrap through `@alga-psa/workflows/runtime`, and rewriting worker, EE package, server, and EE UI callers to the package surface.
- (2026-03-13) Completed F009/F010/F011 on top of the same tranche because the new `persistence`, `bundle`, and `workers` entrypoints now exist in `ee/packages/workflows/src/*`, active callers were rewired to them, and the worker compile path reached the post-`tsc` tool stage without TypeScript errors.
- (2026-03-13) Completed F012/F013/F014/F015/F021/F022/F023 in the same tranche by moving stream/event-builder, expression-authoring, secrets, services, client/type, server helper, and dependent package imports to `@alga-psa/workflows/*`, and by adding direct `@alga-psa/workflows` dependencies to touched workspaces.
- (2026-03-13) Completed F020 by removing the static EE workflow inference import from shared runtime registration. Shared runtime now exposes an injectable AI inference hook, and the EE runtime entrypoint wires that hook before registering AI actions.
- (2026-03-13) Validation outcome for the first tranche:
  - `pnpm --filter @alga-psa/workflows typecheck` passed.
  - `pnpm --filter workflow-worker build` reached the post-`tsc` tooling stage and then failed because `tsc-alias` is not installed in this workspace.
  - `pnpm --filter @alga-psa/workflows build` is still blocked locally because `tsup` is not installed in this workspace.
- (2026-03-13) Completed T023 by running `pnpm --filter server typecheck` after the server helper rewrites. The server package typecheck passed with the new `@alga-psa/workflows/*` imports.
- (2026-03-13) Completed T046 by updating `server/src/lib/jobs/tests/renewalQueueScheduling.wiring.test.ts` to assert the new `@alga-psa/workflows/runtime` import string instead of the old shared runtime import strings.
- (2026-03-13) Remaining shared-workflow references after the first tranche are concentrated in tests, legacy tsconfig aliases, and the system-email-processing workflow migration string path. Those are the next cleanup targets before F024/F025/F026/F034 can be marked complete.
- (2026-03-13) Completed F016/F017/F018/F019 by moving the AI schema types, action registration wiring, output-schema resolution seam, and publish-validation usage fully behind `@alga-psa/workflows/runtime`; `pnpm --filter sebastian-ee typecheck` passed after the EE designer AI typing fixes.
- (2026-03-13) Completed F024/F025/F026 by rewriting the remaining wiring tests to `@alga-psa/workflows/*`, backfilling deep EE proxy entrypoints for test-only legacy subpaths, removing `@shared/workflow*` tsconfig aliases, and cleaning the last stale migration string reference. Repo-wide import audit is now clean outside docs.
- (2026-03-13) Completed T001/T002/T003/T004/T005/T006/T009/T010/T011/T014/T015/T016/T017/T018/T019/T020/T021/T022/T047 with the second tranche. Evidence:
  - `pnpm --filter @alga-psa/workflows typecheck` passed after adding wildcard exports and deep proxy files.
  - `pnpm --filter server typecheck`, `pnpm --filter sebastian-ee typecheck`, and `pnpm --filter workflow-worker exec tsc -p tsconfig.json` passed with the new namespace and without shared-workflow tsconfig aliases.
  - `rg -n "@shared/workflow|@alga-psa/shared/workflow" . -g '!**/docs/**' -g '!**/dist/**'` returned no matches.
- (2026-03-13) Focused runtime sanity checks after the second tranche:
  - `server/src/test/unit/email/inboundEmailBodyParsing.test.ts` passed through the new `@alga-psa/workflows/actions/emailWorkflowActions` proxy.
  - `server/src/test/unit/workflowSchemaRegistry.unit.test.ts` failed on an existing auth spy expectation (`hasPermission` was not observed), not on import resolution.
  - `ee/server` Vitest resolution is still blocked for `workflowDataContext.test.ts` by unrelated package-entry resolution for `@alga-psa/storage`.
- (2026-03-13) The workflow bundle integration suite was also still on the pre-cutover auth/DB harness. Route-level bundle export/import now needs both canonical mocks (`@alga-psa/db`, `@alga-psa/auth`) and the compatibility `server/src/lib/db` mock because the Next route wrappers still call the compatibility helper.
- (2026-03-13) The EE workflow-designer Vitest config was missing source aliases for workspace packages that are only available as built outputs in package manifests (`@alga-psa/storage`, `@alga-psa/event-bus`, `@alga-psa/types`, `@alga-psa/validation`, `@alga-psa/auth`, `@alga-psa/event-schemas`). Focused designer suites need those aliases to execute against source in this workspace.
- (2026-03-13) There were no focused task-inbox coverage files exercising the moved `@alga-psa/workflows/persistence` task surface. Added a narrow EE unit suite around `taskInboxActions` to cover submit, inbox aggregation, and dismiss/revalidate behavior directly at the action boundary.
- (2026-03-13) `packages/storage` and `packages/scheduling` Vitest configs were both assuming built package exports. Running the stream publisher suites from source required explicit aliases for EE workflows/event-schemas/core and, for scheduling, expanding `include` to cover `src/**/*.test.ts`.
- (2026-03-13) The shared `registerAiActions` test was still coupled to the pre-cutover direct EE inference import. Post-cutover, the stable seam is `configureWorkflowAiInferenceService`, so the test now needs to register a mock service through that runtime hook.
- (2026-03-13) Package-local `node_modules` are absent in this workspace, but the root workspace has the required CLIs. Manual build-equivalent validation through `../../node_modules/.bin/tsc-alias` and `../../../node_modules/.bin/tsup` is sufficient to prove the cutovered package graphs build cleanly.
- (2026-03-13) The remaining EE-server schedule coverage could not rely on `workflow-external-schedules.actions.integration.test.ts` in this workspace because no local Postgres listener is available on `localhost:5432`; replacing that with focused unit action tests was lower-risk than pretending the infra failure was a product regression.
- (2026-03-13) A top-level `WorkflowDesigner` smoke render needed two things in the EE Vitest harness: a wider set of workspace source aliases (`analytics`, `billing`, `tags`, `scheduling`, `documents`, `notifications`, `user-composition`, `product-extension-actions`, DB model/core server/auth subpaths, `fs` builtins) and aggressive mocking of UI/local designer subcomponents so the smoke test validates the designer shell instead of transitively compiling unrelated product surfaces.
- (2026-03-13) Completed F027/T029 by fixing stale runtime integration harnesses and publish assertions after the ownership move:
  - `server/vitest.config.ts` now points `@alga-psa/product-extension-actions` at the real OSS entrypoint and pre-creates `coverage/.tmp` so focused Vitest runs stop failing on harness setup.
  - `server/src/test/integration/workflowRuntimeV2.control.integration.test.ts` and `server/src/test/integration/workflowRuntimeV2.eventTrigger.integration.test.ts` now mock `@alga-psa/db` and `@alga-psa/auth`, matching the canonical runtime imports.
  - `server/src/test/integration/workflowRuntimeV2.publish.integration.test.ts` now asserts the current publish/runtime contract (`PAYLOAD_SCHEMA_REF_UNKNOWN`, required mappings on `test.actionProvided`, event triggers with `sourcePayloadSchemaRef`, and revalidation failure via an injected `unknown.node` definition).
  - Evidence:
    - `pnpm --filter server exec vitest run src/test/integration/workflowRuntimeV2.publish.integration.test.ts` passed.
    - `pnpm --filter server exec vitest run src/test/integration/workflowRuntimeV2.control.integration.test.ts` passed.
    - `pnpm --filter server exec vitest run src/test/unit/workflowRuntimeV2.unit.test.ts` passed.
- (2026-03-13) Completed F028/T030 by fixing the worker E2E harness to the canonical package boundary and rerunning the worker-focused smoke subset:
  - `server/src/test/e2e/workflowRuntimeV2.e2e.test.ts` now mocks `@alga-psa/db` and `@alga-psa/auth`, bootstraps `tenant_workflow_schedule`, seeds a tenant row, and publishes the email workflow fixture through the real create/publish actions with explicit trigger mapping.
  - The worker-focused E2E subset passed with the new package ownership and covers publish/start, event-triggered launch, wait/resume, timeout processing, retry lease handling, idempotent action reuse, cancel-before-resume, and admin resume.
  - Evidence:
    - `pnpm --filter server exec vitest run src/test/e2e/workflowRuntimeV2.e2e.test.ts -t "publish a workflow|event trigger starts workflow run|event.wait pauses run|timeout on event.wait|retryable action failure|idempotent action call|canceling a running workflow|resume a WAITING run"` passed (8 tests, 8 skipped).
- (2026-03-13) Completed F029/T032/T043 by restoring the bundle import/export integration harness to the post-cutover package boundary:
  - `server/src/test/integration/workflowBundleV1.importExport.integration.test.ts` now mocks `@alga-psa/db`, `@alga-psa/auth`, and the compatibility `server/src/lib/db` module, and ensures `tenant_workflow_schedule` exists before bundle tests execute runtime-backed publish/start paths.
  - The restored suite covers canonical export formatting, HTTP export/import routes, round-trip canonical normalization, dependency validation, AI inline-schema round-tripping, and end-to-end execution of an imported workflow.
  - Evidence:
    - `pnpm --filter server exec vitest run src/test/integration/workflowBundleV1.importExport.integration.test.ts` passed.
- (2026-03-13) Completed F030/T033/T034/T035 by fixing the EE designer Vitest harness and rerunning focused workflow-designer coverage:
  - `ee/server/vitest.config.ts` now maps the workspace package sources needed by the designer test graph instead of relying on missing built package entries.
  - The focused designer suites passed for grouped action hydration/persistence, AI downstream reference options, and workflow data-context output typing.
  - Evidence:
    - `pnpm --filter sebastian-ee exec vitest run src/components/workflow-designer/__tests__/groupedActionStep.test.ts src/components/workflow-designer/__tests__/workflowReferenceOptions.test.ts src/components/workflow-designer/__tests__/workflowDataContext.test.ts` passed.
- (2026-03-13) Completed F031/T041 by adding focused task-inbox action coverage against the EE persistence surface:
  - Added `ee/server/src/__tests__/unit/workflowTaskInboxActions.test.ts` to exercise task submission/history, inbox aggregation + dedupe + pagination, and dismiss/revalidate behavior using the moved `@alga-psa/workflows/persistence` task interfaces.
  - Evidence:
    - `pnpm --filter sebastian-ee exec vitest run src/__tests__/unit/workflowTaskInboxActions.test.ts` passed.
- (2026-03-13) Completed F032/T045 by validating workflow-owned stream helper consumers across multiple packages after the import cutover:
  - `server` billing payload-builder suites still validate workflow payload contracts for invoice and payment events via `@alga-psa/workflows/streams/workflowEventPublishHelpers`.
  - `packages/integrations`, `packages/storage`, and `packages/scheduling` publisher suites passed after updating their Vitest source-alias config to resolve the EE workflow stream surface directly from source.
  - Evidence:
    - `pnpm --filter server exec vitest run src/test/unit/paymentWorkflowEvents.test.ts src/test/unit/invoiceWorkflowEvents.test.ts` passed.
    - `node ../../node_modules/vitest/vitest.mjs run src/lib/__tests__/externalMappingWorkflowEvents.test.ts` passed in `packages/integrations`.
    - `node ../../node_modules/vitest/vitest.mjs run tests/storageService.workflowEvents.test.ts` passed in `packages/storage`.
    - `node ../../node_modules/vitest/vitest.mjs run src/lib/__tests__/capacityThresholdWorkflowEvents.publisher.test.ts` passed in `packages/scheduling`.
- (2026-03-13) Completed F033/T036/T037/T038/T039/T040 by rerunning focused AI compatibility coverage against the post-cutover seams:
  - `shared/workflow/runtime/actions/__tests__/registerAiActions.test.ts` now exercises the EE-owned runtime registration seam via `configureWorkflowAiInferenceService` instead of the removed direct inference import path.
  - The shared AI suites passed for runtime registration, schema parsing/validation, and output-schema resolution.
  - The server workflow runtime suites passed for publish-time AI schema validation and runtime `ai.infer` output handling.
  - Evidence:
    - `node ./node_modules/vitest/vitest.mjs run --config shared/vitest.config.ts shared/workflow/runtime/actions/__tests__/registerAiActions.test.ts shared/workflow/runtime/ai/__tests__/aiSchema.test.ts shared/workflow/runtime/actions/__tests__/actionOutputSchemaResolver.test.ts` passed.
    - `pnpm --filter server exec vitest run src/test/unit/workflowRuntimeV2.unit.test.ts src/test/integration/workflowRuntimeV2.publish.integration.test.ts` passed.
- (2026-03-13) Completed T007/T008/T012/T013/T024/T025/T026/T027/T028 by running manual build/typecheck validation across the remaining package boundaries:
  - `services/workflow-worker` completed the full post-compile chain (`tsc`, `tsc-alias`, import extension fixer, runtime import validator) using the root workspace CLIs.
  - `ee/packages/workflows` completed both `tsc --noEmit` and `tsup` using the root workspace CLIs, proving the expanded entrypoint surface still builds.
  - The dependent stream/secrets consumers typechecked cleanly in `billing`, `scheduling`, `clients`, `projects`, `storage`, `documents`, `notifications`, and `tenancy`.
  - Evidence:
    - `../../node_modules/.bin/tsc -p tsconfig.json && ../../node_modules/.bin/tsc-alias -p tsconfig.json -f --resolve-full-paths && node scripts/fix-relative-import-extensions.mjs && node scripts/validate-runtime-imports.mjs` passed in `services/workflow-worker`.
    - `../../../node_modules/.bin/tsc --noEmit -p tsconfig.json && ../../../node_modules/.bin/tsup` passed in `ee/packages/workflows`.
    - `pnpm --filter @alga-psa/billing typecheck` passed.
    - `pnpm --filter @alga-psa/scheduling typecheck` passed.
    - `pnpm --filter @alga-psa/clients typecheck` passed.
    - `pnpm --filter @alga-psa/projects typecheck` passed.
    - `pnpm --filter @alga-psa/storage typecheck` passed.
    - `pnpm --filter @alga-psa/documents typecheck` passed.
    - `pnpm --filter @alga-psa/notifications typecheck` passed.
    - `pnpm --filter @alga-psa/tenancy typecheck` passed.
- (2026-03-13) Completed T031/T048 by adding focused worker coverage at the EE package boundary:
  - Added `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts` to assert stream consumer startup, event ingestion, runtime-event persistence, workflow launch handoff, and duplicate-event suppression through `@alga-psa/workflows/*`.
  - Added `services/workflow-worker/src/index.startup.test.ts` to smoke the worker entrypoint bootstrap, including runtime initialization, email-provider registration, enterprise storage registration, worker construction, and start hooks.
  - `shared/vitest.config.ts` now aliases the remaining workspace packages (`@alga-psa/workflows`, `@alga-psa/email`, `@alga-psa/event-schemas`) needed for service-level tests to resolve from source.
  - Evidence:
    - `node ./node_modules/vitest/vitest.mjs run --config shared/vitest.config.ts services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.test.ts services/workflow-worker/src/index.startup.test.ts` passed.
- (2026-03-13) Completed T042/T044/T049/T050 by restoring the last focused action/smoke suites to the post-cutover graph:
  - `server/src/test/unit/workflowRunLauncher.unit.test.ts` and `server/src/test/unit/workflowScheduledRunHandlers.unit.test.ts` now mock the named `@alga-psa/workflows/persistence` surface and current handler path, matching the cutovered runtime/persistence ownership.
  - Added `ee/server/src/__tests__/unit/workflowEventCatalogActions.test.ts` and `ee/server/src/__tests__/unit/workflowScheduleActions.test.ts` for focused event-catalog and schedule action coverage without depending on unavailable local Postgres infrastructure.
  - Added `ee/server/src/components/workflow-designer/__tests__/WorkflowDesigner.smoke.test.tsx` for a top-level designer shell render smoke against the EE workflows package actions.
  - `ee/server/vitest.config.ts` now carries the workspace aliases required for those EE-server smoke tests to resolve from source.
  - Evidence:
    - `pnpm --filter server exec vitest run src/test/unit/workflowRunLauncher.unit.test.ts src/test/unit/workflowScheduledRunHandlers.unit.test.ts` passed.
    - `pnpm --filter sebastian-ee exec vitest run src/__tests__/unit/workflowEventCatalogActions.test.ts src/__tests__/unit/workflowScheduleActions.test.ts src/components/workflow-designer/__tests__/WorkflowDesigner.smoke.test.tsx` passed.
    - `pnpm --filter server exec vitest run src/test/unit/workflowRuntimeV2.unit.test.ts src/test/integration/workflowRuntimeV2.publish.integration.test.ts` had already passed in the AI validation tranche and continues to cover the main EE workflow action runtime path.
- (2026-03-13) Completed F034/T051 by removing the last live non-test `shared/workflow` consumer outside the package scaffolding and re-running the active-path audit:
  - `services/workflow-worker/dlq-util.js` now imports Redis stream helpers from `@alga-psa/workflows/streams`.
  - The remaining `shared/workflow` matches outside docs/dist are now limited to comments, inert tooling, a legacy migration string, and the EE package's internal re-export scaffolding; the active caller surface outside the package no longer points at `shared/workflow`.
  - Evidence:
    - `rg -n "shared/workflow" . -g '!**/docs/**' -g '!**/dist/**' -g '!**/coverage/**' -g '!ee/packages/workflows/**' -g '!shared/workflow/**' -g '!**/*test*.ts' -g '!**/*.test.ts' -g '!**/*.test.tsx' -g '!**/__tests__/**' -g '!server/src/test/**' -g '!packages/**/tests/**' -g '!docker-compose*.yaml' -g '!Dockerfile*' -g '!eslint.config.js'` returned only comments/tooling plus the legacy migration string.
