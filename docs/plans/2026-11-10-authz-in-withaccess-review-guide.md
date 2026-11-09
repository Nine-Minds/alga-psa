# Human review — Security: authz in withAccess

**Finding:** High severity — task-comment REST authorization ignored API-key-specific project bundle assignments.
**Plan:** [2026-11-10-authz-in-withaccess-fix-plan.md](./2026-11-10-authz-in-withaccess-fix-plan.md), approved at `0628b0467142f48a511c65c742376811b4695b2d`.
**Review first:** `ProjectTaskCommentService.withAccess` at `server/src/lib/api/services/ProjectTaskCommentService.ts:75-89`, the subject builder at `packages/projects/src/lib/projectReadAuthorization.ts:50-83`, and the behavioral test at `server/src/test/integration/authorization/projectTaskCommentApiKeyBundle.integration.test.ts:180-252`.

## Finding confirmation

- Verified API authentication resolves the API key record and places its identity in `apiRequest.context.apiKeyId` at `server/src/lib/api/controllers/ApiBaseController.ts:88-101`.
- Before this change, `ProjectTaskCommentService.withAccess` called `withTaskCommentAccess` without that field; task-comment authorization then made project decisions through `projectDecider` without key identity. All REST operations route through this boundary: list/get, create, update, delete, and reaction toggle are visible in `server/src/lib/api/services/ProjectTaskCommentService.ts:132-220`.
- `resolveBundleNarrowingRulesForEvaluation` only adds the `api_key` assignment target when `input.subject.apiKeyId` is truthy (`packages/authorization/src/bundles/service.ts:924-932`). If the key assignment is not loaded, a resource/action with no matching bundle rule receives `ALLOW_ALL_SCOPE` (`packages/authorization/src/kernel/providers/bundleProvider.ts:73-86`). This confirmed the approved plan’s finding in the checkout.

## Change and boundary

The service now passes the verified `context.apiKeyId` into `withTaskCommentAccess`. The shared task-comment boundary threads it through `projectDecider` to `createProjectReadAuthorizer`, which builds the `AuthorizationSubject` with `apiKeyId: apiKeyId ?? null`. The batch-read boundary uses the same identity path. Coarse `project_task` permissions, transaction behavior, and forbidden-versus-missing 404 masking remain in the shared boundary. Parameters are trailing and optional, preserving existing callers. No request body supplies key identity.

## Behavioral evidence

The integration fixture uses one user and two API keys, an assigned in-scope project, an unassigned out-of-scope project, and a published `assigned` bundle on `project:read` and `project:update`, assigned only to the restricted key. It first exercises `createProjectReadAuthorizer` against the actual project rows and verifies that the template permits the assigned project and denies the unassigned project. It then drives the real `ProjectTaskCommentService` and bundle evaluator for all five REST operations under restricted-key, open-key, and no-key contexts. Denied create/update/delete/reaction calls verify persisted state is unchanged. Batch-read behavior is tested through `withTaskCommentBatchReadAccess`.

Failure-before / pass-after evidence was captured on the isolated database `TEST_DB_NAME=test_authz_in_withaccess`:

- Before: temporarily removed only API-key propagation at the REST/task-comment boundary. The regression failed as expected because the restricted-key out-of-scope `listComments` promise resolved with the comment instead of rejecting with `NotFoundError`; the batch read also returned both task IDs. The test fixture’s explicit-key authorizer check remained enabled, confirming the `assigned` template itself excluded the out-of-scope record.
- After: restored propagation. Both integration cases passed, including the complete identity/operation matrix and batch read.

## Validation

Commands run from `server/` unless noted:

```sh
TEST_DB_NAME=test_authz_in_withaccess npx vitest run --config vitest.config.ts \
  src/test/integration/authorization/projectTaskCommentApiKeyBundle.integration.test.ts \
  src/test/unit/api/projectTaskCommentService.authorization.test.ts \
  src/test/unit/api/projectTaskCommentRoutes.test.ts \
  ../packages/projects/src/lib/taskComments/taskCommentAuthorization.test.ts --coverage.enabled=false
```

Final result: 4 test files passed, 28/28 tests total. The pre-fix comparison failed at the expected unauthorized read and batch authorization assertions.

Package TypeScript checks completed successfully:

```sh
npm run typecheck --workspace=@alga-psa/projects
npm run typecheck --workspace=@alga-psa/authorization
```

Both package typechecks passed. The changed project and authorization packages also built successfully:

```sh
npm run build --workspace=@alga-psa/projects
npm run build --workspace=@alga-psa/authorization
```

The full server typecheck did not complete: `npm run typecheck --workspace=server` exhausted Node’s default 4 GB heap, and `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck --workspace=server` also exhausted its heap. A focused TypeScript check over the changed REST service and its new/updated test files passed with `npx tsc --project /tmp/tsconfig-authz-in-withaccess.json` (the temporary config extends `server/tsconfig.json` and includes only those three files). This leaves the repository-wide server typecheck unverified; the failed commands are not counted as passing checks.

## Expected access tightening and remaining gap

After this fix, an API key with an active restrictive project bundle cannot read or mutate task comments on projects outside that key’s scope. Other keys for the same user remain governed by their own assignments, and callers without key identity retain existing session behavior.

The separate server-action/MCP path remains unresolved as described in the approved plan: `projectTaskCommentActions.ts` can call the same shared helper, but `runWithApiKeyUser` does not make `apiKeyId` available in ambient identity context. This draft does not change that path or consolidate package-level subject builders.

**Human captain approval is required. No separate AI verification is requested.**
