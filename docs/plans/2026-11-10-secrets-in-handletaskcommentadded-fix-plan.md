# Fix plan — Security: secrets in `handleTaskCommentAdded`

- **Card:** c1eecbda-43b0-5901-91d4-5e43a026a0e5
- **Finding:** `secrets` · high — notification fan-out discloses task-comment content to users the repaired read path now hides.
- **Fingerprint:** `server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts#handleTaskCommentAdded`
- **Source:** security review of PR #3987 (merge `e75baf12b57c`).
- **Verdict:** Finding is **real and unaddressed on this branch.** No fix exists yet. Plan below, no code changed.

---

## 1. The defect, precisely

### What PR #3987 repaired, and the invariant it established

PR #3987 made every project-task-comment **read/write surface** route through one
record-level authorization boundary, `withTaskCommentAccess`
(`packages/projects/src/lib/taskComments/taskCommentAuthorization.ts:104-146`).
That boundary resolves a comment/task to its **parent project** and runs the
record-level project decision for the caller
(`projectDecider` → `createProjectReadAuthorizer`,
`packages/projects/src/lib/projectReadAuthorization.ts:102-140`). The decision is
*not* the coarse `project_task:read` RBAC grant — it is the kernel decision that
honours **bundle narrowing** (`resolveBundleNarrowingRulesForEvaluation`), which can
restrict a user to a subset of the tenant's projects even when their role grants
`project:read` globally (`projectReadAuthorization.ts:1-11`). A task/comment in a
project the caller may not read now returns the same "not found" error as a missing
id, so content and existence are both hidden
(`taskCommentAuthorization.ts:12-15, 130-133`).

The established invariant: **a user narrowed away from a project must not see that
project's task-comment content.**

### Which check is missing

The **notification fan-out path never evaluates that decision.** When a task comment
is added/edited, two event subscribers independently compute recipients and push the
full comment content to them, keyed only on *mention* or *assignment*, with no
per-recipient project-read check:

1. **Internal notifications** — `internalNotificationSubscriber.handleTaskCommentAdded`
   (`server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts:1419-1611`):
   - `@everyone` expands to **every active internal user in the tenant**
     (`resolveEveryoneMention`, lines 1352-1371; `is_inactive=false` only — no project scope).
   - Mentioned users each get a `user-mentioned` notification whose `metadata.commentText`
     is the **full comment markdown** (not a preview), plus `projectName`/`taskName`
     (lines 1499-1549; `commentText` stored at line 1533).
   - Every task assignee (primary `assigned_to` + `task_resources`, via
     `getAllTaskAssignees`, lines 409-438) gets a `task-comment-added` notification with
     a `commentPreview` and project/task names (lines 1560-1598).
   - None of these recipients is checked against the parent project's read decision.

2. **Internal notifications on edit** —
   `internalNotificationSubscriber.handleTaskCommentUpdated`
   (lines 1616-1756): newly-mentioned users get the same full-`commentText` payload
   (lines 1694-1748). Same gap.

3. **Email** — `projectEmailSubscriber.handleTaskCommentAdded`
   (`server/src/lib/eventBus/subscribers/projectEmailSubscriber.ts:1459-1588`): builds
   the full HTML + text comment body (`contentHtml`/`contentText`, lines 1497-1535) and
   emails it to every primary/additional assignee with a valid address (lines 1542-1577).
   No project-read check.

### Concrete attacker path

Tenant uses bundle narrowing so that user **U** is an MSP agent whose bundle no longer
includes project **P** (they were rotated off it), but U is still listed as an assignee
on task **T** in P, or is still an active internal user. Another member of P adds a
comment on T containing sensitive content (e.g. client financials, a credential).

- Via the **web/REST read path** (post-#3987), U loading T's comments gets "not found" —
  content hidden. Correct.
- Via **fan-out**, U nonetheless receives: an internal notification whose
  `metadata.commentText` holds the full comment, *and* an email containing the full
  HTML/text body. Content leaks through exactly the channel #3987 did not touch.

`@everyone` widens the blast radius to every active internal user regardless of project
membership: a single `@everyone` mention in a narrowed project's task comment fans the
full comment text out tenant-wide.

This is a pre-existing flow #3987 explicitly left unchanged; the finding is accurate.

### Note on the fingerprint line

The finding anchors line 1513; the enclosing leak is the mention-notification block
`1499-1549` (full `commentText` at 1533) plus the assignee block `1560-1598`. The
anchor is correct in substance; the fix spans the whole handler and its two siblings.

---

## 2. The fix

### Shape: reuse the existing ticket precedent, don't invent a parallel one

The ticket side already solved this exact class of bug. Board-rule ticket notifications
are admitted through **`filterRecipientsWhoCanReadTicket`**
(`server/src/lib/notifications/boardNotificationAudience.ts:24-47`): for each candidate
recipient it loads `getUserWithRoles`, checks coarse `ticket:read`, then runs the
**per-record** policy (`authorizeTicketRecordAccess`), dropping a recipient only on an
access-denied error and re-throwing anything else (so a DB error on the inbound-outbox
transaction is not swallowed). `handleTicketCommentAdded` already calls it
(imported at `internalNotificationSubscriber.ts:35`).

The project/task side has **no equivalent**. That absence *is* the bug. The fix is to
build the project analogue and route every task-comment recipient list through it.

### 2a. New shared admission helper (the single enforcement point)

Create `server/src/lib/notifications/projectNotificationAudience.ts`, mirroring
`boardNotificationAudience.ts`:

```ts
// filterRecipientsWhoCanReadProject(db, tenant, projectId, userIds): Promise<string[]>
// For each userId:
//   - user = await getUserWithRoles(userId, tenant); skip if null
//   - skip unless await hasPermission(user, 'project_task', 'read', db)   // coarse floor
//   - await assertProjectReadAllowed(db, tenant, user, projectId)          // per-record kernel decision
//   - keep userId
// Drop a recipient ONLY on an access-denied error ("Permission denied" prefix /
// "Project not found"); re-throw everything else (matches isAccessDenied in the ticket file).
```

- It lives in `server/` (not the `@alga-psa/projects` package) for the same reason the
  ticket helper lives in `server/`: it composes `@alga-psa/auth` (`hasPermission`) with
  the projects authorizer, and must take the caller-supplied `db`/`trx` so it runs inside
  the inbound-outbox transaction when there is one.
- `assertProjectReadAllowed` already exists and already encapsulates "load project +
  run record decision + throw on denial" (`projectReadAuthorization.ts:146-163`); it is
  the same primitive `withTaskCommentAccess` uses, so the fan-out decision is provably
  the **same decision** as the read path. It is importable from server today via
  `@alga-psa/projects/lib/projectReadAuthorization` (tsconfig `@alga-psa/projects/*` →
  `packages/projects/src/*`, `server/tsconfig.json:174`, `tsconfig.base.json:69`; webpack
  alias `server/next.config.mjs:343-344`). Server already imports sibling
  `@alga-psa/projects/lib/*` modules, so no package.json `exports` change is required.

**Why this is the enforcement point that cannot be bypassed by another route:** the only
two code paths that fan task-comment *content* out to users are the two subscriber
handlers below. Both are converted to compute a candidate recipient list and then pass
it through `filterRecipientsWhoCanReadProject` before any notification/email is created.
There is no third task-comment content sink (verified: `TASK_COMMENT_ADDED` /
`TASK_COMMENT_UPDATED` consumers are only `internalNotificationSubscriber` and
`projectEmailSubscriber`; the other matches are publishers, schemas, search indexer, and
the MCP/OpenAPI registry, none of which email/notify). A future third sink is the
residual risk (see §4); the helper is the shared home so adding one is a one-line call.

### 2b. Wire it into every fan-out site

1. `internalNotificationSubscriber.handleTaskCommentAdded`
   (`internalNotificationSubscriber.ts:1419-1611`):
   - After `resolvedMentionedUserIds` is computed (line 1494-1496) and before the
     `mentionedUsers` DB fetch (1500), filter the id list through
     `filterRecipientsWhoCanReadProject(db, tenantId, task.project_id, resolvedMentionedUserIds)`.
     Use `task.project_id` (the authoritative parent project resolved at 1445-1448), not
     the payload `projectId`, so the decision matches the read path's resolution.
   - After `getAllTaskAssignees` (line 1560) and before the assignee loop (1562), filter
     `allAssignees` the same way.

2. `internalNotificationSubscriber.handleTaskCommentUpdated`
   (`internalNotificationSubscriber.ts:1616-1756`): filter `resolvedNewlyMentionedUserIds`
   (line 1695-1696) through the helper before the `newlyMentionedUsers` fetch (1699).

3. `projectEmailSubscriber.handleTaskCommentAdded`
   (`projectEmailSubscriber.ts:1459-1588`): after the `assignees` array is assembled
   (lines 1542-1562) and before the send loop (1565), reduce it to the subset whose
   `user_id` is returned by
   `filterRecipientsWhoCanReadProject(db, tenantId, task.project_id, assignees.map(a => a.user_id))`.

In all three, the comment **author** continues to be excluded as today (they are the
actor, not a leak target). `@everyone` is handled for free: expansion still happens, but
the expanded list is now filtered to project-readable users, collapsing the tenant-wide
blast radius to project members.

### 2c. Export the two task-comment handlers for testing

Add `handleTaskCommentAdded` and `handleTaskCommentUpdated` to
`internalNotificationSubscriberTestHarness` (`internalNotificationSubscriber.ts:3436-3451`)
so the behavioral test can drive them directly (today the harness exports only ticket
handlers).

---

## 3. The proof (tests)

### Test A — admission helper unit test (behavioral, primary)

New `server/src/lib/notifications/__tests__/projectNotificationAudience.test.ts`,
mirroring the mocking style of
`packages/projects/src/lib/taskComments/taskCommentAuthorization.test.ts:1-53`
(mock `getUserWithRoles`, `hasPermission`, and `assertProjectReadAllowed` so the record
decision is a controllable set of allowed projects per user).

- **Asserts:** given recipients `[allowed, narrowed, noCoarse]` and project `P`,
  `filterRecipientsWhoCanReadProject` returns `['allowed']` — `narrowed` is dropped
  because `assertProjectReadAllowed` throws "Permission denied", `noCoarse` is dropped
  because `hasPermission` is false.
- **Also asserts:** a non-access error (e.g. `assertProjectReadAllowed` rejecting with a
  generic DB error) **propagates** rather than silently dropping the recipient (guards
  the inbound-outbox transaction-abort hazard, matching the ticket helper's contract).
- **Fails before the fix:** the module does not exist.

### Test B — subscriber fan-out regression test (behavioral, the finding itself)

New `server/src/lib/eventBus/subscribers/__tests__/internalNotificationSubscriber.taskCommentAudience.test.ts`.
Mock `@alga-psa/notifications/actions.createNotificationFromTemplateInternal` (spy), the
`getConnection`/`tenantDb` surface to return a task in project `P` with assignees
`[allowed, narrowed]`, and the new `projectNotificationAudience` module so `narrowed` is
not project-readable. Drive `internalNotificationSubscriberTestHarness.handleTaskCommentAdded`
with an event whose comment mentions `narrowed` and `@everyone`.

- **Asserts:** `createNotificationFromTemplateInternal` is called for `allowed` and is
  **never** called with `user_id: narrowed`; no payload carrying `metadata.commentText`
  reaches a non-readable recipient.
- **Fails before the fix:** today both the mention block (1513-1541) and the assignee loop
  (1562-1598) notify `narrowed`, so the "never called for narrowed" assertion fails.

### Test C — wiring guard (source-level, cheap, matches existing style)

The repo already uses source-substring guards to pin that a handler invokes a policy
(e.g. `internalNotificationSubscriber.suppression.test.ts:36-58`). Add equivalent guards
asserting each of the three handler bodies contains a
`filterRecipientsWhoCanReadProject(` call, so a future refactor that drops the gate on any
one path fails CI even if Test B's mocks drift.

- **Fails before the fix:** no handler references the helper.

---

## 4. Scope, non-goals, risks

### Deliberately NOT doing

- **No change to the read/write boundary** (`withTaskCommentAccess`,
  `projectReadAuthorization`): #3987 established it correctly; this card consumes it, it
  does not re-open it.
- **No ticket-side change:** tickets already admit recipients correctly
  (`filterRecipientsWhoCanReadTicket`). Out of scope.
- **No new push-notification sink:** the finding mentions "push," but there is no
  task-comment push subscriber on this branch (only the internal + email subscribers
  consume the events). Push notifications derive from the internal notification records,
  so gating the internal records at the source also gates any downstream push. Nothing to
  add; noted so a reviewer doesn't expect a push file.
- **No redaction/partial-preview mechanism:** the fix is binary admission (readable →
  full content as today; not readable → nothing), matching the read path's all-or-nothing
  "not found." We do not introduce a redacted-preview tier.
- **No de-duplication of the two subscribers** into one fan-out engine. Tempting
  (`// LEVERAGE: pattern notification-recipient-admission` — the same "resolve parent
  record → filter recipients by record read decision" now exists for tickets and
  projects), but that extraction is a separate, larger change; this card's floor is to
  stop the leak using the proven ticket-shaped helper. Marker-worthy, not in scope.

### Risks / regressions a reviewer should weigh

- **Per-recipient cost:** the helper runs `getUserWithRoles` + a kernel decision per
  recipient. `@everyone` in a large tenant now does O(active internal users) decisions on
  the comment-added path. The project authorizer memoises the project decision per
  authorizer instance but here each recipient is a distinct subject, so there is no cross-
  recipient reuse. Acceptable for correctness (the ticket path already accepts the same
  shape), but the reviewer should confirm this runs off the request hot path (it does —
  these are async event subscribers) and consider a follow-up batching optimisation.
- **Transaction-abort hazard:** the inbound-outbox path passes a live transaction as
  `db`. The helper **must** re-throw non-access errors (not swallow them), exactly as the
  ticket helper does, or a DB error would be masked and surface later as a misleading
  "transaction is aborted." The test (A) pins this.
- **`task.project_id` vs payload `projectId`:** the fix decides against the project
  resolved from the task row (`internalNotificationSubscriber.ts:1445-1448`), which is the
  same resolution the read boundary uses. If they ever diverged, deciding on the payload
  value would be the bug; the plan deliberately uses the resolved value.
- **Behavior change users will notice:** an agent narrowed off a project who was still a
  task assignee will stop receiving that project's comment notifications/emails. That is
  the intended security outcome, but it is a visible change; worth a line in the human
  review guide.
- **Inactive/invalid recipients:** existing filters (`is_inactive`, `isValidEmail`,
  interactive-user-type) remain; the new gate is additive and runs alongside them.
