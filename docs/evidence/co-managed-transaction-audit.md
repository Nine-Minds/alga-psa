# Transaction-boundary audit: co-managed operational transactions

Scope: every `withCoManagedOperationalTransaction(` call site, plus every
function that accepts a caller's database handle and also calls
`createTenantKnex()`. Completes the audit that cb65a3444d opened.

**Outcome: 57 call sites across 15 files, all safe. No new defects. No
exemptions needed.** `TRANSACTION_THREADING_EXEMPTIONS` in
`scripts/check-transaction-threading.mjs` remains empty, which is the correct
state: no call site in this codebase currently needs an independent connection.

## The failure class

A function takes the caller's `Knex.Transaction`, ignores it, calls
`createTenantKnex()` and opens a transaction on a *second pool connection*. If
the caller holds a `FOR UPDATE` lock on a row the callee writes, that second
connection waits on the caller's lock while the caller awaits the callee.

PostgreSQL's deadlock detector never fires, because only one transaction is
waiting — the other party is blocked in application code, not in the database.
So the symptom is not an error. It is silence.

`StorageService.deleteFile` did exactly this. Its caller, the comment-attachment
draft sweep, runs inside `initializeApp()` during instrumentation `register()`,
so once drafts aged past the 24h grace, every boot wedged all HTTP.

The fix is always the same: give the opener the caller's handle.
`withCoManagedOperationalTransaction` delegates to `withTransaction`, which
recognises a supplied transaction and reuses it, so threading costs nothing when
the caller has no transaction to give.

## How the count was measured

```
git grep -n 'withCoManagedOperationalTransaction(' -- '*.ts' '*.tsx' | wc -l   # 57
git grep -l 'withCoManagedOperationalTransaction(' -- '*.ts' '*.tsx' | wc -l   # 15
```

**57 call sites across 15 files** — not the 21 files the work order estimated.
The count is over tracked `.ts`/`.tsx` files across the whole repository, so it
is not restricted to the roots the static detector scans. The declaration in
`packages/licensing/src/lib/co-managed-lifecycle.ts:93` is written
`withCoManagedOperationalTransaction<T>(` and so is not among the 57; all 57 are
genuine call sites.

Line numbers below are as of this commit. Six of them shifted by three lines
from an earlier reading because this audit added `LEVERAGE` markers.

## Classification

Every row is **safe**, by one of four routes:

- **pass-through** (44 sites) — the function's first parameter is a *required*
  `Knex | Knex.Transaction`, handed straight to the opener. The caller decides
  what the transaction is; the callee cannot open a second one. This is the
  model layer, and it is why the defect was confined to one site.
- **transaction root** (9 sites) — a `withAuth` server action with no db-handle
  parameter at all. There is no caller transaction to join, so `createTenantKnex()`
  is the root of the transaction rather than a second one.
- **threaded** (2 sites) — the function accepts an *optional* caller handle and
  honours it: `StorageService.deleteFile` via `transaction ?? knex`, and
  `KbArticleService.withArticleWrite` via `getDbForContext`'s `context.db ?? …`.
- **test fixture** (2 sites).

| # | `file:line` | Enclosing function | Opens on | Class | Why |
|---|---|---|---|---|---|
| 1 | `packages/documents/src/actions/kbArticleActions.ts:481` | `submitForReview` | `knex` | **safe** (transaction root) | `withAuth` server action with no db-handle parameter: there is no caller transaction to join, so opening on `knex` from `createTenantKnex()` is the root of the transaction, not a second one. |
| 2 | `packages/documents/src/actions/kbArticleActions.ts:568` | `completeReview` | `knex` | **safe** (transaction root) | `withAuth` server action with no db-handle parameter: there is no caller transaction to join, so opening on `knex` from `createTenantKnex()` is the root of the transaction, not a second one. |
| 3 | `packages/documents/src/actions/kbArticleActions.ts:1021` | `recordArticleView` | `knex` | **safe** (transaction root) | `withAuth` server action with no db-handle parameter: there is no caller transaction to join, so opening on `knex` from `createTenantKnex()` is the root of the transaction, not a second one. |
| 4 | `packages/documents/src/actions/kbArticleActions.ts:1052` | `recordArticleFeedback` | `knex` | **safe** (transaction root) | `withAuth` server action with no db-handle parameter: there is no caller transaction to join, so opening on `knex` from `createTenantKnex()` is the root of the transaction, not a second one. |
| 5 | `packages/documents/src/actions/kbArticleActions.ts:1197` | `resumeArticleImport` | `knex` | **safe** (transaction root) | `withAuth` server action with no db-handle parameter: there is no caller transaction to join, so opening on `knex` from `createTenantKnex()` is the root of the transaction, not a second one. |
| 6 | `packages/documents/src/actions/kbArticleActions.ts:1284` | `startArticleImport` | `knex` | **safe** (transaction root) | `withAuth` server action with no db-handle parameter: there is no caller transaction to join, so opening on `knex` from `createTenantKnex()` is the root of the transaction, not a second one. |
| 7 | `packages/projects/src/actions/projectActions.ts:1796` | `deleteProject` | `knex` | **safe** (transaction root) | `deleteProject` server action; no db-handle parameter. |
| 8 | `packages/projects/src/actions/projectStatusUpdateActions.ts:492` | `sendProjectStatusUpdate` | `knex` | **safe** (transaction root) | `sendProjectStatusUpdate` server action; no db-handle parameter. |
| 9 | `packages/projects/src/models/project.ts:181` | `ProjectModel.create` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 10 | `packages/projects/src/models/project.ts:231` | `ProjectModel.update` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 11 | `packages/projects/src/models/project.ts:289` | `ProjectModel.delete` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 12 | `packages/projects/src/models/project.ts:446` | `ProjectModel.addPhase` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 13 | `packages/projects/src/models/project.ts:488` | `ProjectModel.updatePhase` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 14 | `packages/projects/src/models/project.ts:523` | `ProjectModel.deletePhase` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 15 | `packages/projects/src/models/project.ts:715` | `ProjectModel.addProjectStatusMapping` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 16 | `packages/projects/src/models/project.ts:844` | `ProjectModel.addStatusToProject` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 17 | `packages/projects/src/models/project.ts:885` | `ProjectModel.updateProjectStatus` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 18 | `packages/projects/src/models/project.ts:909` | `ProjectModel.deleteProjectStatus` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 19 | `packages/projects/src/models/project.ts:955` | `ProjectModel.updateStructure` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 20 | `packages/projects/src/models/project.ts:1104` | `ProjectModel.copyProjectStatusMappingsToPhase` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx: Knex | Knex.Transaction` is required and handed straight to the opener; no `createTenantKnex()` in the body. |
| 21 | `packages/projects/src/models/projectTask.ts:25` | `ProjectTaskModel.addTask` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 22 | `packages/projects/src/models/projectTask.ts:77` | `ProjectTaskModel.updateTask` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 23 | `packages/projects/src/models/projectTask.ts:160` | `ProjectTaskModel.updateTaskStatus` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 24 | `packages/projects/src/models/projectTask.ts:211` | `ProjectTaskModel.deleteTask` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 25 | `packages/projects/src/models/projectTask.ts:297` | `ProjectTaskModel.reorderTasksInStatus` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 26 | `packages/projects/src/models/projectTask.ts:334` | `ProjectTaskModel.addChecklistItem` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 27 | `packages/projects/src/models/projectTask.ts:351` | `ProjectTaskModel.updateChecklistItem` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 28 | `packages/projects/src/models/projectTask.ts:367` | `ProjectTaskModel.deleteChecklistItem` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 29 | `packages/projects/src/models/projectTask.ts:392` | `ProjectTaskModel.deleteChecklistItems` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 30 | `packages/projects/src/models/projectTask.ts:436` | `ProjectTaskModel.addTaskResource` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 31 | `packages/projects/src/models/projectTask.ts:477` | `ProjectTaskModel.removeTaskResource` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 32 | `packages/projects/src/models/projectTask.ts:525` | `ProjectTaskModel.addTaskTicketLink` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 33 | `packages/projects/src/models/projectTask.ts:666` | `ProjectTaskModel.deleteTaskTicketLink` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 34 | `packages/projects/src/models/projectTask.ts:682` | `ProjectTaskModel.deleteTaskTicketLinksByTicketId` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 35 | `packages/projects/src/models/projectTask.ts:698` | `ProjectTaskModel.updateTaskTicketLink` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 36 | `packages/projects/src/models/taskDependency.ts:38` | `TaskDependencyModel.addDependency` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 37 | `packages/projects/src/models/taskDependency.ts:142` | `TaskDependencyModel.updateDependency` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 38 | `packages/projects/src/models/taskDependency.ts:158` | `TaskDependencyModel.removeDependency` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 39 | `packages/projects/src/models/taskType.ts:54` | `TaskTypeModel.createCustomTaskType` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 40 | `packages/projects/src/models/taskType.ts:77` | `TaskTypeModel.updateCustomTaskType` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 41 | `packages/projects/src/models/taskType.ts:93` | `TaskTypeModel.deleteCustomTaskType` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required, passed straight through; no `createTenantKnex()`. |
| 42 | `packages/projects/src/services/projectOrderingService.ts:36` | `writeOrderKeys` | `conn` | **safe** (pass-through) | `conn: Knex | Knex.Transaction` required; repair and regeneration share the caller's transaction and its admission locks. |
| 43 | `packages/storage/src/StorageService.ts:83` | `persistUploadedFile` | `db` | **safe** (pass-through) | `persistUploadedFile(db: Knex, ...)` — required parameter, passed straight through. Typed plain `Knex` rather than `Knex | Knex.Transaction`, so it cannot accept a caller transaction; no caller has one to give (see note 3). |
| 44 | `packages/storage/src/StorageService.ts:493` | `StorageService.deleteFile` | `db` | **safe** (threaded) | `StorageService.deleteFile` — `const db = transaction ?? knex`. The site fixed by cb65a3444d, and the only call site in the codebase that reuses an *optional* caller transaction. |
| 45 | `packages/storage/src/models/storage.ts:17` | `FileStoreModel.create` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required. Tenant resolution goes through `requireTenantId(knexOrTrx)`, so even that read uses the caller's handle. |
| 46 | `packages/storage/src/models/storage.ts:44` | `FileStoreModel.updateMetadata` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required. Tenant resolution goes through `requireTenantId(knexOrTrx)`, so even that read uses the caller's handle. |
| 47 | `packages/storage/src/models/storage.ts:65` | `FileStoreModel.softDelete` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required. Tenant resolution goes through `requireTenantId(knexOrTrx)`, so even that read uses the caller's handle. |
| 48 | `packages/storage/src/models/storage.ts:93` | `FileStoreModel.createDocumentSystemEntry` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required. Tenant resolution goes through `requireTenantId(knexOrTrx)`, so even that read uses the caller's handle. |
| 49 | `packages/tickets/src/actions/ticketActions.ts:693` | `updateTicket` | `db` | **safe** (transaction root) | `updateTicket` server action; no db-handle parameter. This file is `UU` in the in-progress merge and was read, not edited. |
| 50 | `packages/tickets/src/models/comment.ts:80` | `Comment.insert` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required. `mutateCollaboration` additionally asserts `knexOrTrx.isTransaction`. |
| 51 | `packages/tickets/src/models/comment.ts:239` | `Comment.mutateCollaboration` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required. `mutateCollaboration` additionally asserts `knexOrTrx.isTransaction`. |
| 52 | `packages/tickets/src/models/comment.ts:258` | `Comment.update` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required. `mutateCollaboration` additionally asserts `knexOrTrx.isTransaction`. |
| 53 | `packages/tickets/src/models/comment.ts:331` | `Comment.delete` | `knexOrTrx` | **safe** (pass-through) | `knexOrTrx` required. `mutateCollaboration` additionally asserts `knexOrTrx.isTransaction`. |
| 54 | `server/src/lib/api/services/KbArticleService.ts:149` | `KbArticleService.withArticleWrite` | `connection` | **safe** (threaded) | `getDbForContext(context)` returns `context.db` when the caller supplied one and falls back to `createTenantKnex()` otherwise — the same rule as `transaction ?? knex`, expressed through the service context. |
| 55 | `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts:493` | `rename (fixture)` | `db` | **safe** (test fixture) | Suite fixture. Line 593 deliberately passes an open `trx` to assert that nested reuse leaves the caller's transaction intact. |
| 56 | `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts:593` | `nested-reuse fixture` | `trx` | **safe** (test fixture) | Suite fixture. Line 593 deliberately passes an open `trx` to assert that nested reuse leaves the caller's transaction intact. |
| 57 | `shared/models/kbArticleModel.ts:119` | `createKbArticle` | `connection` | **safe** (pass-through) | `connection: Knex | Knex.Transaction` required, passed straight through. |

## Functions that take a db handle and also call `createTenantKnex()`

`scripts/check-transaction-threading.mjs` reports zero of these across 726
scanned files. The five candidates an earlier, looser pass surfaced were each
read in full rather than taken on trust. All five are safe, and four of them are
the same idiom:

| `file:line` | Function | Class | Verdict |
|---|---|---|---|
| `packages/auth/src/services/PasswordResetService.ts:375` | `cleanupExpiredTokens(trx?, tenantId?)` | **safe** | `return trx ? cleanup(trx) : withTransaction(knex, cleanup)`. The supplied transaction is used directly; `knex` is only reached when there is none. |
| `packages/portal-shared/src/services/PortalInvitationService.ts:402` | `cleanupExpiredTokens(trx?)` | **safe** | Same ternary. Additionally resolves its tenant with `requireTenantId(trx ?? knex)`, so even that read prefers the caller's handle. |
| `packages/users/src/services/UserInvitationService.ts:276` | `cleanupExpiredTokens(trx?)` | **safe** | Same ternary, same `requireTenantId(trx ?? knex)`. |
| `packages/user-composition/src/actions/userQueryActions.ts:266` | `getUserRolesWithPermissions(userId, knexConnection?)` | **safe** | Branches before acquiring anything: when `knexConnection` is supplied it is used directly and `createTenantKnex()` is never called — it sits in the `else`. |
| `packages/projects/src/actions/projectActions.ts:1395` | `createProject(projectData, selectedTaskStatusIds?, options?)` | **safe**, with a latent note | `const externalTrx = options?.trx` is threaded through both the status read and `createProjectInTransaction`. See note 2. |

So your reading was right on all five — recorded here as verified rather than
assumed.

### Note 1 — the detector cannot see indirection, so a second sweep was run

The static check only fires when a transaction opener and `createTenantKnex()`
appear in the *same* function body. A function that takes `trx` and calls a
zero-argument helper that acquires its own pool handle one level down is
invisible to it. A separate manual sweep therefore looked for the other ways a
fresh connection is acquired — `getConnection(`, `getAdminConnection(`,
`getTenantConnection(`, bare `knex({` — in functions that also take a db handle.

That sweep read roughly 25 function bodies out of 141 candidates and found **no
violations**. Everything it surfaced honours the supplied handle, in yet more
spellings of the same rule:

- `ee/server/src/lib/stripe/StripeService.ts` (six sites) — `const db = knex || (await getConnection(tenantId))`.
- `ee/server/src/lib/auth/oauthAccountLinks.ts:94`, `ee/server/src/lib/billing/tenantReactivationDetection.ts:81`, `ee/server/src/lib/billing/tenantReactivationTokens.ts:64` — `?? getAdminConnection()`.
- `packages/db/src/lib/tenantId.ts:4` — `knexOrTrx ?? (await getConnection(null))`.
- `packages/licensing/src/lib/ai-gateway-auth.ts:9`, `packages/licensing/src/lib/tenant-license-state.ts:41` — `connection ?? await getAdminConnection()`.
- `server/src/lib/eventBus/subscribers/coManagedCustomerCommentEmailSubscriber.ts:13` and `coManagedRequesterCommentEmailSubscriber.ts:16,28` — `connection ?? await getConnection(tenantId)`.

Two look like the defect on a grep and are not:

- `ee/temporal-workflows/src/db/tenant-operations.ts:34` calls `getAdminConnection()` but uses the result only for `knex.fn.now()` value builders. Every query runs on `trx`; no connection is checked out and no transaction is opened on it.
- `shared/lib/ticketCommentAttachments.ts:10` calls `getConnection(tenantId)` strictly inside a `registerAfterCommit(trx, …)` callback — after the caller's transaction and its `comments` lock have committed. Safe by construction, and the one shape in the codebase that *would* have justified an exemption if it were not already after the commit boundary.

One shape is worth remembering without being a defect:
`packages/licensing/src/lib/license-state.ts:80` does `const knex = connection ?? await getAdminConnection()` and then `knex.transaction(...)` directly rather than through `withTransaction`. The parameter is honoured, so there is no second connection; but a supplied `Knex.Transaction` would become a *savepoint* rather than a reused frame, which is a different rollback boundary than every other call site in this audit gets.

### Note 2 — `createProject`'s reads before the transaction

`createProject` threads `options.trx` correctly through everything transactional.
Two reads before the transaction still run on a pool handle: the
`checkPermission` call at line 1412 and `getProjectStatusesInternal`, which opens
its own `withTransaction(knex, …)`.

This is not currently reachable: `ProjectQuickAdd.tsx:186` and
`server/src/lib/api/services/ProjectService.ts` are the only callers and neither
passes `options.trx`. If one ever does, the hazard is not only a lock wait — a
pool connection also cannot see statuses the caller created in its own
uncommitted transaction, so the project would be built from stale status rows.
Marked at the call site rather than changed, because changing it now would be
rewriting a path no caller exercises.

### Note 3 — `persistUploadedFile` cannot accept a transaction

`packages/storage/src/StorageService.ts:83` types its first parameter `db: Knex`,
not `Knex | Knex.Transaction`. Its callers (`uploadFile`, `uploadStream`) accept
no transaction either, so nothing is lost today. It is recorded because it is the
one place in the storage package where the type *forbids* the fix that
`deleteFile` needed.

## Two premises worth correcting

**`withTransaction` reuses a supplied transaction directly — it does not open a
savepoint.** `packages/db/src/lib/tenant.ts:188` tests for `commit`/`rollback`
methods and, when it finds them, calls the callback with the same transaction
object. So a threaded call shares the caller's rollback boundary exactly; an
error inside does not roll back to a nested point. `withSavepoint` is the
separate primitive for that. This does not change any classification above, but
"nested savepoint frame" describes `withSavepoint`, not this path.

**There is a production lock-timeout guardrail, and the test suite removes it.**
`server/migrations/20260609120000_set_app_role_db_guardrail_timeouts.cjs` sets
`lock_timeout = 8s` and `idle_in_transaction_session_timeout = 60s` on the
application role. `resetAppRoleGucs` in `server/test-utils/dbConfig.ts` clears
both after every bootstrap, deliberately, so ordinary fixtures are not aborted
mid-test. Two consequences:

1. No suite could observe a lock *wait* at all — a blocked test blocked forever.
   The new integration test sets `lock_timeout` explicitly for its own run and
   resets it afterwards.
2. Even with the guardrail active, 8s would not have saved the boot. The sweep
   catches per-candidate failures and retries, so each of up to 100 drafts per
   tenant would have burned 8s in turn while `initializeApp()` never returned.
   The guardrail converts "wedged forever" into "wedged for many minutes, every
   boot".

On the machine this audit ran on, `pg_roles.rolconfig` for `app_user` is empty:
the guardrail is not in effect there, which is consistent with the original
report of an unbounded hang.

## Why this shipped, and what now covers it

The sweep had tests. Four of them, in
`server/src/test/integration/ticketCommentAttachmentsIntegration.test.ts`. Every
one injects a fake `remove` callback, so none ever reached
`StorageService.deleteFile` — the code where the defect lived. The sweep's
*logic* was covered; its only real side effect was not.

Coverage added:

| Test | Guards |
|---|---|
| `server/src/test/unit/build/transactionThreading.contract.test.ts` | Runs `scripts/check-transaction-threading.mjs --json` and fails CI on any new violation. Includes a positive control (a fixture with the pre-cb65a3444d shape must still be flagged) so the check cannot go quietly vacuous, and a negative control (the `?? knex` and `trx ? work(trx) : …` shapes must clear it). |
| `server/src/test/integration/transactionThreadingDeadlock.integration.test.ts`, first suite | Each transaction-accepting entry point is invoked with a transaction that already holds `SELECT … FOR UPDATE` on the row it will write. Includes the real `cleanupCommentAttachmentDrafts` → real `StorageService.deleteFile` path that no existing test reached. |
| `server/src/test/integration/transactionThreadingDeadlock.integration.test.ts`, second suite | The boot sweep with an expired draft present: `reconcileScheduledCommentPublications()`, the function `initializeApp()` awaits, must finish within a bounded time and actually mark the draft swept. |

`npm run check:transaction-threading` runs the detector from a terminal.

The integration suite makes a regression *fail* rather than hang, via two
independent guards: `lock_timeout` on the application role (a precise PostgreSQL
error) and a wall-clock deadline (in case the pool handed out a connection that
predates the role setting). The fixture is committed rather than rolled back on
purpose — a rolled-back fixture is invisible to a second connection, so a
regression would fail with `File not found` and never demonstrate the lock wait.

### Verified by mutation

With cb65a3444d reverted in the working tree:

```
scripts/check-transaction-threading.mjs
  packages/storage/src/StorageService.ts:477  deleteFile(transaction)
      opens on: knex

transactionThreading.contract.test.ts              1 failed | 2 passed
  has no function that accepts a caller handle and opens its own connection
    → function(s) take a caller database handle but open a second connection anyway.

transactionThreadingDeadlock.integration.test.ts   3 failed | 3 passed
  StorageService.deleteFile …
    → Failed to delete file: update "external_files" set "is_deleted" = $1, … 
      - canceling statement due to lock timeout
  cleanupCommentAttachmentDrafts …  → the draft must be marked swept: expected null to be truthy
  the initializeApp draft sweep …   → the expired draft must be swept, not skipped: expected null to be truthy
```

The mutation was re-run after the database pinning described above was added, to
confirm the pinning had not made the suite pass regardless of the fix. With the
fix restored, the detector reports `OK: 726 files scanned` and all six
integration tests pass. The two sweep tests fail through a second mechanism worth
noting: the sweep swallows the per-candidate error and moves on, so the draft is
simply never cleaned — which is exactly what production did, forever, on every
boot.

### Two traps found while building the coverage

**`server/src/test/unit/build/` is gitignored.** `.gitignore:48` ignores `build/`
at any depth, so `workspaceDistResolution.contract.test.ts` — the sibling check
this one was modelled on — is untracked. It runs for whoever has it in their
working tree and nowhere else; it is not in CI. The transaction-threading
contract test was therefore placed at
`server/src/test/unit/transactionThreading.contract.test.ts`, alongside the other
`*.contract.test.ts` files, where git will keep it. The dist-resolution check
needs the same treatment.

**An integration test cannot assume `DB_NAME_SERVER` still points at its own
database.** The code under test does not use the handle the test creates — it
calls `createTenantKnex()`/`getConnection()`, which build a pool from
`DB_NAME_SERVER` *at call time*. `createTestDbConnection()` sets that variable,
but a later `dotenv` load can put the developer's own database name back. The
first draft of the boot test hit exactly this: the sweep ran against a database
with no fixture in it, found nothing to do, and returned instantly. Every timing
assertion would have passed for entirely the wrong reason.

The suite now reads the database name off its live connection and pins
`DB_NAME_SERVER` to it, and the boot test asserts up front that the
application's own connection can see the fixture before it measures anything.
Any suite that exercises a code path through the application's connection
factory needs the same guard; without it, a green run means nothing.

A related detail: the file opens one database handle, at file scope, for both
suites. A second `createTestDbConnection()` in the same file races the first
one's drop-and-recreate and fails with `database ... does not exist` the first
time a given `TEST_DB_NAME` is used — green on re-runs, red on a cold CI
machine.

## What a future reader should watch

The detector proves a *local* property: no single function body both accepts a
handle and opens on a fresh one. It cannot prove the transitive one. If a new
entry point takes a `trx` and calls a zero-argument service method that acquires
its own connection several frames down, nothing here will catch it. The
integration suite is the backstop for that, which is why it is written around
entry points and a held lock rather than around `deleteFile`.

## Reproducing

```
node scripts/check-transaction-threading.mjs        # or: npm run check:transaction-threading
cd server && npx vitest run src/test/unit/build/transactionThreading.contract.test.ts
cd server && TEST_DB_NAME=<unique> DB_HOST=127.0.0.1 DB_PORT=5472 \
  npx vitest run src/test/integration/transactionThreadingDeadlock.integration.test.ts
```

The integration suite needs the direct PostgreSQL port (5472), not pgbouncer,
and database credentials from `server/.env.local`. Load that file line by line:
`DB_PASSWORD_SERVER` and `REDIS_PASSWORD` both contain an unquoted `&`, which
`set -a; . ./.env.local` hands to the shell as a background operator, silently
leaving both empty.
