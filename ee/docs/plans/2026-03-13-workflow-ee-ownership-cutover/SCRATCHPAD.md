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
