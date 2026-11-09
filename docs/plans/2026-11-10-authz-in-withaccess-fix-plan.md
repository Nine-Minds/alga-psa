# Fix plan — Security: authz in withAccess (task-comment REST path drops API-key bundle narrowing)

- **Card:** Security: authz in withAccess (`340b5fe1-0586-5586-a754-cf37efa2abcb`)
- **Source finding:** security review of PR #3987, merge `e75baf12b57c`, review card `a7238205-5ad8-5947-ad30-b47f9f7549f3`
- **Fingerprint:** `server/src/lib/api/services/ProjectTaskCommentService.ts#withAccess`
- **Verdict:** **Confirmed real.** No fix exists on this branch yet. This is a forward-looking plan.

---

## 1. The defect

### What is missing
The REST task-comment authorization boundary builds a project-record authorization
**subject that never carries `apiKeyId`**, so API-key-specific bundle narrowing is silently skipped.

The verified authentication layer records the key identity:

- `server/src/lib/api/controllers/ApiBaseController.ts:93-101` sets
  `apiRequest.context.apiKeyId = keyRecord.api_key_id` on the API context.
- `packages/db/src/services/BaseService.ts:43-50` — `ServiceContext.apiKeyId` is "set by the
  verified API transport, never from a request body."

But the task-comment REST path discards it:

- `server/src/lib/api/services/ProjectTaskCommentService.ts:83` — `withAccess` calls
  `withTaskCommentAccess(knex, context.tenant, context.user as IUserWithRoles, target, action, …)`.
  `context.apiKeyId` is in scope but is never passed.
- `packages/projects/src/lib/taskComments/taskCommentAuthorization.ts:104-146` —
  `withTaskCommentAccess` takes `user` only. Its per-project decider
  (`projectDecider`, lines 86-102) calls `createProjectReadAuthorizer(trx, tenant, user, recordAction)`
  — again no apiKeyId.
- `packages/projects/src/lib/projectReadAuthorization.ts:50-82` —
  `resolveAuthorizationSubjectForUser` constructs the `AuthorizationSubject` from the user only.
  The returned object (lines 72-81) has `tenant, userId, userType, roleIds, teamIds,
  managedUserIds, clientId, portfolioClientIds` — **no `apiKeyId`**, even though the field
  exists on the contract (`packages/authorization/src/kernel/contracts.ts:24`).

### Why that disables the control
- `packages/authorization/src/bundles/service.ts:924-932` — `resolveBundleNarrowingRulesForEvaluation`
  only appends the `api_key` target clause when `input.subject.apiKeyId` is truthy. With no apiKeyId
  on the subject, assignments whose `target_type = 'api_key'` are never queried.
- `packages/authorization/src/kernel/providers/bundleProvider.ts:73-86` — when no narrowing rule
  matches the resource/action, the provider returns `ALLOW_ALL_SCOPE` for the bundle layer. A
  restriction that was never loaded cannot deny.

### Concrete attack path
1. A tenant user holds the coarse `project_task` permission (read/create/update/delete) — enough to
   pass `assertCoarse` (`taskCommentAuthorization.ts:74-83`).
2. An admin assigns that user an API key and binds a **restrictive project bundle to the key**
   (`authorization_bundle_assignments.target_type = 'api_key'`), e.g. an `assigned`/`selected_clients`
   template that limits the key to a subset of projects.
3. The attacker calls the task-comment REST endpoints (GET / POST / PUT / DELETE / reactions) on a
   task whose parent project is **outside** the key's bundle scope.
4. The record decision runs with a subject lacking `apiKeyId` → the key's bundle rule is never loaded
   → the bundle layer returns allow-all → the coarse grant carries the request through. The key reads
   and mutates comments on projects it was explicitly scoped away from.

### Contrast that proves this is a path-specific gap, not a kernel bug
The sibling REST surface already does this correctly. `ApiProjectController.assertProjectReadAllowed`
(`server/src/lib/api/controllers/ApiProjectController.ts:82-107`) calls
`authorizeApiResourceRead({ …, apiKeyId: apiRequest.context.apiKeyId, … })`, and
`authorizeApiResourceRead` → `buildAuthorizationPrincipalSubject(user, apiKeyId)`
(`server/src/lib/api/controllers/authorizationKernel.ts:91-96`) sets `subject.apiKeyId`. The
task-comment path is the one REST surface that authorizes through the **packages-level**
`createProjectReadAuthorizer`, whose subject builder has no apiKeyId parameter at all. PR #3987 added
the record-level boundary here but inherited that builder's omission.

---

## 2. The fix

Thread the verified `apiKeyId` into the single subject-construction point on this path. Enforcement
cannot be bypassed because **every** task-comment REST op (read, create, update, delete, react) funnels
through `withTaskCommentAccess` → `projectDecider` → `createProjectReadAuthorizer` →
`resolveAuthorizationSubjectForUser`. Setting `apiKeyId` there covers all five actions with no
alternate route.

### Exact edits

1. `packages/projects/src/lib/projectReadAuthorization.ts`
   - `resolveAuthorizationSubjectForUser(conn, tenant, user, apiKeyId?: string | null)` — add the param
     and set `apiKeyId: apiKeyId ?? null` on the returned subject (lines 50-82).
   - `createProjectReadAuthorizer(conn, tenant, user, action = 'read', apiKeyId?: string | null)` —
     add trailing optional param, forward it to `resolveAuthorizationSubjectForUser` (lines 102-108).
   - `assertProjectReadAllowed(conn, tenant, user, projectId, apiKeyId?: string | null)` — add trailing
     optional param, forward to `createProjectReadAuthorizer` (lines 146-157). (Keeps the helper
     consistent for the import/export/staging callers even though this card does not exercise them.)

2. `packages/projects/src/lib/taskComments/taskCommentAuthorization.ts`
   - `withTaskCommentAccess(..., work, apiKeyId?: string | null)` — add trailing optional param (line 104).
   - `projectDecider(trx, tenant, user, recordAction, apiKeyId?)` — add param; forward to
     `createProjectReadAuthorizer(trx, tenant, user, recordAction, apiKeyId)` (lines 86-95, 132).
   - Thread the same apiKeyId into `withTaskCommentBatchReadAccess` / its `projectDecider` call
     (lines 149-178) so the batch read path (used by comment-count/reaction batch surfaces) is covered
     by the same change rather than left as a second latent hole.

3. `server/src/lib/api/services/ProjectTaskCommentService.ts`
   - `withAccess` (line 83) — pass `context.apiKeyId` as the new trailing argument to
     `withTaskCommentAccess`. `context` is already `ServiceContext`, which carries `apiKeyId`.

### Why this is the right home (and the recurrence question)
`resolveAuthorizationSubjectForUser` in `projectReadAuthorization.ts` is the one subject builder for
the project-record decision on this path; fixing it there (not at the controller) means the web
server-action callers get identical, correct behavior for free: session users pass no apiKeyId, so
`subject.apiKeyId` stays null and no `api_key` clause is added — which is exactly right for sessions.

An optional, default-undefined parameter is deliberately **not** a feature flag: it is the honest
representation of "this caller may or may not be an API key." It changes no existing caller's behavior
(they compile and run unchanged) and only the REST transport, which actually has a key, supplies a value.

**Recurrence / shared-helper note (not fixed here, see §4).** `resolveAuthorizationSubjectForUser` is
reimplemented per package — `packages/tickets/src/lib/ticketRecordAuthorization.ts:58`,
`packages/assets/src/actions/assetActions.ts:499`, `packages/billing/src/actions/quoteActions.ts:249`,
`packages/projects/src/actions/projectTaskStatusActions.ts:250`, plus the server-side canonical
`buildAuthorizationPrincipalSubject` that *does* thread apiKeyId. This duplication is the reason the
same "API-key narrowing dropped" bug can recur on any REST surface that authorizes through a
packages-level builder instead of the controller-level `authorizeApiResourceRead`. The durable fix is
to collapse these onto one subject builder that always accepts apiKeyId. That consolidation is a
`// LEVERAGE: friction` candidate and is out of scope for this security card — called out so the
reviewer weighs it, not silently widened into.

---

## 3. The proof

### Primary — behavioral integration test (required by acceptance)
New file: `server/src/test/integration/authorization/projectTaskCommentApiKeyBundle.integration.test.ts`,
modeled on `server/src/test/integration/authorization/bundleAssignmentResolution.integration.test.ts`
(uses `TestContext` + `createAuthorizationBundle` / `upsertBundleRule` / `publishBundleRevision` /
`createBundleAssignment`, with `cleanupTables` including `authorization_bundle_assignments`,
`authorization_bundle_rules`, `authorization_bundle_revisions`, `authorization_bundles`, `api_keys`).

Fixture (one tenant, one internal user who holds coarse `project_task` read/create/update/delete):
- Two API keys for the **same** user: `K_restricted` and `K_open` (rows in `api_keys`).
- Two projects: `P_in` (assigned to the user → in scope) and `P_out` (not assigned → out of scope),
  each with a phase, a task, and an existing comment.
- A published project bundle whose rule restricts `project:read`/`project:update` to the in-scope set
  (e.g. `templateKey: 'assigned'`, matched against `assignedUserIds` from `project.assigned_to` —
  `projectReadAuthorization.ts:84-95`). Assign that bundle to **`K_restricted` only**
  (`createBundleAssignment`, `targetType: 'api_key'`).

Assertions — drive `ProjectTaskCommentService` with a `ServiceContext` whose `apiKeyId` is set:
- `apiKeyId = K_restricted`:
  - `getComments` / `createComment` / `updateComment` / `deleteComment` / reaction toggle against the
    **`P_out`** task each reject with `NotFoundError` (the finding's deliberate 404 masking).
  - The same operations against the **`P_in`** task succeed.
- `apiKeyId = K_open` (no bundle): operations against both `P_in` **and** `P_out` succeed.
- `apiKeyId = undefined` (session parity): behavior matches `K_open` — proves the change is inert for
  non-key callers.

**Why it fails before the fix:** today `subject.apiKeyId` is always undefined, so the `api_key` target
clause is never added (`service.ts:930-932`), `K_restricted`'s rule never loads, the bundle layer
returns allow-all, and the `P_out` operation under `K_restricted` **succeeds** — the first assertion
(expect `NotFoundError`) fails. After the fix the rule loads and `P_out` is denied.

### Secondary — fast unit guard (recommended)
Extend `server/src/test/unit/api/projectTaskCommentService.authorization.test.ts` (or
`packages/projects/src/lib/taskComments/taskCommentAuthorization.test.ts`). Those suites already mock
`createProjectReadAuthorizer`; replace the mock with a `vi.fn` and assert it is invoked with the
`apiKeyId` argument when `withAccess` runs with `context.apiKeyId = 'key-123'`, and with
`undefined`/null when the context has none. This pins the plumbing without a DB and fails before the
fix (the argument is never passed). It does not replace the integration test — the integration test is
the behavioral evidence the card requires; this is a cheap regression tripwire.

---

## 4. Scope not covered, and reviewer risks

**Deliberately not doing:**
- **Consolidating the duplicated subject builders** (tickets/assets/billing/project-status + the
  server-side `buildAuthorizationPrincipalSubject`). Correct long-term home for the class of bug, but a
  cross-package refactor beyond this finding's fingerprint. Logged as a `// LEVERAGE: friction`
  candidate (§2), not executed.
- **The web server-action / MCP path.** `projectTaskCommentActions.ts` also calls
  `withTaskCommentAccess`, but server actions reached via `runWithApiKeyUser`
  (`packages/auth/src/lib/apiKeyUserContext.ts`) carry no ambient `apiKeyId` — there is no apiKeyId
  async-local store, only the user. So MCP/API-key callers that reach comments through server actions
  remain un-narrowed by `api_key` bundles after this fix. That is a **pre-existing, separate** gap
  outside this finding's REST fingerprint; flagged here so it is not mistaken for "closed by this card."
  Closing it would require threading apiKeyId through the server-action context, which this plan does
  not touch.
- **Auditing every other `createProjectReadAuthorizer` / `assertProjectReadAllowed` REST caller**
  (`ApiProjectController` already threads apiKeyId via `authorizeApiResourceRead`; staging/import/export
  actions go through `assertProjectReadAllowed`). Follow-up audit recommended, not performed here.

**Risks a reviewer should weigh:**
- **Signature change blast radius:** all new params are trailing and optional, so existing callers of
  `createProjectReadAuthorizer` / `assertProjectReadAllowed` / `withTaskCommentAccess` compile and run
  unchanged. Only `projectDecider` (internal to `taskCommentAuthorization.ts`) and the
  `ProjectTaskCommentService.withAccess` call site must be updated in lockstep.
- **Tightening is a behavior change by design:** any caller that was (incorrectly) relying on
  `api_key` bundles being ignored will now be denied. That is the intended security correction, but it
  is observable — if a real API key is already assigned a restrictive project bundle, its task-comment
  access narrows the moment this ships.
- **No performance concern:** same kernel, one extra target clause in the bundle query, only when
  `apiKeyId` is present.
- **Template choice in the test:** the regression test must pick a narrowing template that actually
  denies `P_out` given the `AuthorizationRecord` the project authorizer builds
  (`ownerUserId`/`assignedUserIds`/`clientId` only — `projectReadAuthorization.ts:86-96`).
  `'assigned'` against `assigned_to` is the most direct; the implementer should confirm the chosen
  template’s evaluator denies an unassigned project before relying on the assertion.
