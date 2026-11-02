# Security authz — `getCoManagedProjectTaskSnapshot` assignee redaction

Card: Security: authz in getCoManagedProjectTaskSnapshot (`d08e0efd`) · PSA ticket alga-2026-0002992
Base: `origin/main` @ `4f3ca6d132` · Worktree `feature/security-authz-in-getcomanagedprojecttasksnapsho`
Finding: `packages/co-managed/src/projectTaskEditing.ts#getCoManagedProjectTaskSnapshot` (authz, high),
from the review of PR #3988 / merge `1709830ce6d3`.

---

## 0. Decision (Design Session, 2026-10-31)

**The defect is already fixed on current main.** Commit `e4bd6b6b66` — *fix(co-managed): deny task
snapshot/history/status/edit when tasks resource is redacted; mask snapshot assignee (alga-2026-0002967)*
— landed the exact suggested fix on 2026-10-30, after the review that raised this finding. No new
production code is required for this card.

Evidence on base `4f3ca6d132`:

- `packages/co-managed/src/projectTaskEditing.ts:22-24` — `assigneeOf()` now takes `redacted` and runs the
  name through `maskCoManagedSnapshot(redacted, …, { name: CO_MANAGED_ASSIGNEE_NAME_ALIASES })`.
- `packages/co-managed/src/projectTaskEditing.ts:88` — the normal snapshot passes
  `context.redactedFields` into `assigneeOf`.
- `packages/co-managed/src/projectTaskEditing.ts:132` — the conflict snapshot (`fresh()`) passes the same
  redactions, closing the stale-revision/revision-drift path the finding called out
  (`projectTaskEditing.ts:128-132` in the report).
- `packages/co-managed/src/sharedWorkProjection.ts:16` —
  `CO_MANAGED_ASSIGNEE_NAME_ALIASES = ['assignee_name', 'values.assignee_name', 'assignee', 'users', 'teams']`,
  i.e. the report's assignee-name alias set.
- The whole-task-redaction guard (`isCoManagedTaskResourceHidden`) additionally denies the snapshot,
  history, status options and edit when `tasks` / `project_tasks` are redacted, before any read
  (`projectTaskEditing.ts:89,120,170`).

Regression coverage already on main:
`server/src/test/integration/coManagedL3cTaskEditing.integration.test.ts` — *masks the snapshot assignee
name when assignee is redacted* (normal load) and the whole-task redaction matrix (snapshot/history/status
options/edit denied, nothing written).

### Remaining gap (the one thing Implement should add)

There is **no regression test for the conflict-snapshot path** named in the finding's evidence: a
deliberately stale `expectedRevision` (or drifted `expectedTaskUpdatedAt`) must return
`TASK_EDIT_CONFLICT` whose `snapshot.assignee.name` is `null` under an assignee-name redaction, while the
concurrency tokens (`revision`, `taskUpdatedAt`) are still present. Production behaviour is already
correct (`fresh()` masks); this closes the evidence gap so `security-finding-resolved` can be answered
from a test rather than from reading the diff.

## 1. Scope paths

- `server/src/test/integration/coManagedL3cTaskEditing.integration.test.ts` (add one test; reuse the
  existing `setRedactions`, `openTask`, `conflictOf` helpers).
- No production changes under `packages/co-managed/src/` and no migration. If the new test exposes a
  real gap (it should not), fix it in `projectTaskEditing.ts` only.

## 2. Test to add

In the `CM L3c task editing and assignment` suite, next to *masks the snapshot assignee name when assignee
is redacted*:

1. Open a task with no redactions; capture `assignee.name`, `revision`, `taskUpdatedAt`.
2. `setRedactions(['assignee'])`.
3. Call `editCoManagedProjectTask` with `expectedRevision: revision - 1` (or `+1`) and a valid patch;
   assert `TASK_EDIT_CONFLICT`, `reason === 'revision'`, `snapshot.revision === revision`,
   `snapshot.taskUpdatedAt === taskUpdatedAt`, `snapshot.assignee?.name ?? null === null`.
4. Repeat with the correct revision but `expectedTaskUpdatedAt` shifted by 1ms; assert `reason ===
   'customer_drift'` and the same masked assignee.
5. `finally { await setRedactions([]); }`.

Also assert the unmasked control (no redactions) still returns the real name, so the test fails without
the mask and passes with it.

## 3. Verification

```
cd server
npx vitest run src/test/integration/coManagedL3cTaskEditing.integration.test.ts
```

Green suite proves: normal snapshot masked, conflict snapshots masked, no writes on rejection, control
unchanged. That is the evidence for the `security-finding-resolved` check.

## 4. Out of scope

- Reworking the redaction policy engine or `maskCoManagedSnapshot` (already correct and unit-tested).
- PR #3999's history-line change (different surface, already merged).
- Any change to `editCoManagedProjectTask`'s accepted fields: assignment stays off the customer task.
