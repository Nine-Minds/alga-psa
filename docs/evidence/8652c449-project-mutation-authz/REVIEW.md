# Project mutation authorization — draft review guide

## Finding disposition

The single high-severity finding is addressed. Project and project-child writes now require the record-level project `read` decision and the decision for the requested write action. Coarse RBAC checks and tenant-scoped project loading remain in place. The authorization kernel and bundle provider are unchanged.

## Review first

1. Review [`assertProjectMutationAllowed`](../../../packages/projects/src/lib/projectReadAuthorization.ts#L216). It keeps the existing read restriction and then enforces the selected `update` or `delete` action. The shared record authorizer evaluates both decisions with one subject, kernel, and request cache.
2. Check [`deleteProject`](../../../packages/projects/src/actions/projectActions.ts#L1796). It passes `delete`; child-resource mutations such as [`updateTaskWithChecklist`](../../../packages/projects/src/actions/projectTaskActions.ts#L591) pass `update` as specified by the plan.
3. Review the mutation call sites in `projectActions.ts`, `projectTaskActions.ts`, `projectTaskStatusActions.ts`, `phaseTaskImportActions.ts`, and `stagingActions.ts`. The bulk task-tag path uses the shared batch mutation authorizer. Remaining direct read assertions are read-only surfaces.

## Behavioral evidence

- [`projectReadAuthorization.mutation.test.ts`](../../../packages/projects/src/lib/projectReadAuthorization.mutation.test.ts) exercises action-specific bundle rules: read allowed/update denied, read allowed/delete denied, read denied/write allowed, allowed mutation, and ordinary read behavior.
- [`projectMutations.authorization.test.ts`](../../../packages/projects/src/actions/projectMutations.authorization.test.ts) exercises project update, project delete, and child-task update actions. It verifies denied writes do not reach the corresponding model write method, confirms project deletion selects `delete`, and compares public results for unreadable and missing projects/tasks.
- [`projectAuthorization.contract.test.ts`](../../../packages/projects/src/actions/projectAuthorization.contract.test.ts) pins shared-boundary use across the mutation surfaces and retains read-path contracts.
- [`projectTaskStatusTenantScoped.contract.test.ts`](../../../packages/projects/src/actions/projectTaskStatusTenantScoped.contract.test.ts) behaviorally checks tenant-filtered project status counts, status updates, and deletion validation/removal where tenant IDs overlap.

## Remaining uncertainty

The new rule intentionally blocks write access when a bundle grants a broader write scope than read scope. Confirm no tenant relies on write-without-read behavior. The app server was not started; no live smoke was run. No uncertainty remains about action matching in the kernel: the provider matches rules by both resource type and action.

## Execution checks

- `npm run typecheck --workspace=@alga-psa/projects` — passed.
- `npm run build --workspace=@alga-psa/projects` — passed.
- Focused Vitest run — 6 files, 39 tests passed, including helper/action regressions, authorization contracts, tenant-isolation behavior, and import behavior.
- Regression sensitivity check — temporarily forcing the shared authorizer to evaluate `read` for every action made 2 of the 6 mutation helper tests fail (update denied and delete denied); restoring action-aware evaluation returned the suite to green.
