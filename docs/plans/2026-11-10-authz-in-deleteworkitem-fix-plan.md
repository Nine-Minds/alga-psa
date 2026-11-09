# Fix plan: broken authorization in `deleteWorkItem`

- **Card:** Security: authz in deleteWorkItem (`3ca79fa1-35a8-5a7d-bf6d-0af0ba94a76e`)
- **Finding:** authz · high — `packages/scheduling/src/actions/timeEntryWorkItemActions.ts#deleteWorkItem`
- **Source:** security review of PR #3987 (merge `e75baf12b57c`); the defect is pre-existing, not introduced by that PR.
- **Status:** finding **confirmed**. No fix exists on this branch yet; this is a forward-looking plan.

---

## 1. The defect, precisely

`deleteWorkItem(workItemId)` is a tenant-wide bulk delete gated only by the coarse `time_entry:delete`
permission. It then deletes **every** `time_entries` row in the tenant that shares the supplied
`work_item_id`, with no further scoping.

Code as it stands (`packages/scheduling/src/actions/timeEntryWorkItemActions.ts:246-288`):

```ts
export const deleteWorkItem = withAuth(async (user, { tenant }, workItemId: string) => {
  ...
  if (!await hasPermission(user, 'time_entry', 'delete', db)) {        // 258: only coarse check
    throw new Error('Permission denied: Cannot delete work items for time entries');
  }
  await db.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, tenant) as any;
    const projectTaskEntries = await scopedDb.table('time_entries')
      .where({ work_item_id: workItemId, work_item_type: 'project_task' })   // 264-266: fetch is only for recalc
      .select('work_item_id');
    await scopedDb.table('time_entries')
      .where({ work_item_id: workItemId })                              // 270-274: deletes ALL matching rows
      .delete();
    await recalculateProjectTaskActualHours(trx, tenant, projectTaskEntries.map(...));
  });
});
```

**What is missing / wrong.** Compared with the normal single-entry path `deleteTimeEntry`
(`packages/scheduling/src/actions/timeEntryCrudActions.ts:649-714`), which for every row:

- resolves the row owner and calls `assertCanActOnBehalf(user, tenant, entry.user_id, trx)`
  (`timeEntryCrudActions.ts:668`), and
- rejects already-invoiced rows (`timeEntryCrudActions.ts:670-672`), and
- routes the delete through `deleteTimeEntryCore` (`packages/scheduling/src/lib/timeEntryWriteCore.ts:677`)
  so bucket draws and hour-block burns are reversed,

`deleteWorkItem` does **none** of these. The raw `.delete()` at line 270:

1. **Ignores row ownership** — no `assertCanActOnBehalf`, so another user's entries are erased.
2. **Ignores invoiced status** — invoiced rows are deleted (the single-entry path forbids this).
3. **Ignores the time sheet** — it is not scoped by `time_sheet_id`, so it reaches across every
   timesheet and every time period that references the work item.
4. **Ignores `work_item_type`** — the delete filters on `work_item_id` alone (the type filter at
   line 264 is only used to seed the recalc list, not the delete).
5. **Bypasses billing/allocation reversal** — the raw delete skips `deleteTimeEntryCore`, so bucket
   usage (`adjustTimeSpanDraw`) and hour-block allocations (`reverseTimeEntryAllocations`) are never
   reversed. This is a data-consistency defect that rides alongside the authz hole.

**Caller / input that reaches it.** The timesheet UI calls the action with only the work-item id:
`packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx:910-912`
(`const result = await deleteWorkItem(workItemId);`). The component already holds the timesheet
identity it *fails* to pass — `timeSheet.id` and `timeSheet.user_id` are in scope at the call site
(see `TimeSheet.tsx:561`, `572`, `588`, `855`). `deleteWorkItem` is also re-exported for the UI via
`packages/scheduling/src/actions/timeEntryActions.ts:25,52` and wired into the time-source seam at
`nativeTimeSource.ts:66` / `timeSource.ts:162`. **There is no REST/API controller caller** — a repo
grep for `deleteWorkItem` / `removeWorkItem` shows only the UI action, the re-export, the time-source
seam, and the native wiring. So the UI is the sole entry point and the signature can be tightened
safely.

**Concrete attacker path.** A Finance-type user holds `time_entry:delete` but, by default, lacks
`time_sheet:approve`. Via the normal `deleteTimeEntry` path they cannot delete a coworker's entry:
`assertCanActOnBehalf` throws `Permission denied: Cannot access other users time sheets`
(`timeEntryDelegationAuth.ts:89-92`). But by calling `deleteWorkItem(sharedWorkItemId)` — for a
ticket or project task multiple people logged time against — they erase **every** user's entries for
that work item across **all** timesheets and periods, **including invoiced entries**, with the bucket
and hour-block ledgers left un-reversed. That is a horizontal-privilege-escalation / destructive-data
authz break.

---

## 2. The fix

**Goal:** `deleteWorkItem` must enforce the same per-row authorization and invoiced guard as
`deleteTimeEntry`, scoped to a single timesheet, and must reuse the shared delete engine so billing
reversal and the guard class cannot drift or be bypassed by this route.

### 2a. Single enforcement point (the engine, reused)

The single enforcement point is **`deleteTimeEntryCore`'s `guard` callback**
(`packages/scheduling/src/lib/timeEntryWriteCore.ts:677-698`) — the same guard `deleteTimeEntry`
already uses (`timeEntryCrudActions.ts:666-674`). It cannot be bypassed because the delete itself
lives inside the core: there is no raw `.delete()` left in `deleteWorkItem`.

Rewrite `deleteWorkItem` (`timeEntryWorkItemActions.ts:246-288`) to:

1. **Accept the timesheet scope.** Change the signature from `(workItemId: string)` to
   `(workItemId: string, timeSheetId: string)`. Validate both (reuse/extend the schemas in
   `timeEntrySchemas.ts`, mirroring `fetchWorkItemsForTimeSheet` at `timeEntryWorkItemActions.ts:50`).
2. **Load the sheet and establish delegation up front**, mirroring `fetchWorkItemsForTimeSheet`
   (`timeEntryWorkItemActions.ts:52-61`): read `time_sheets` by `id` for its `user_id`, throw if not
   found, then `await assertCanActOnBehalf(user, tenant, timeSheet.user_id, db)`. This blocks the
   coworker-erasure path before any write.
3. **Keep the coarse `time_entry:delete` check** (line 258) — it is necessary but no longer
   sufficient.
4. **Select the affected rows inside the transaction, locked** — `select('entry_id','user_id',
   'invoiced','work_item_type','time_sheet_id')` from `time_entries`
   `where({ work_item_id: workItemId, time_sheet_id: timeSheetId })` with `.forUpdate()` so rows
   cannot be invoiced/moved concurrently between check and delete.
5. **Delete each row through `deleteTimeEntryCore`** with the same guard object `deleteTimeEntry`
   uses — `assertCanActOnBehalf(user, tenant, entry.user_id, trx)` **and** the invoiced rejection
   (`timeEntryCrudActions.ts:667-673`). Because every entry on one sheet belongs to the sheet owner,
   the delegation check resolves once per owner; the invoiced guard runs per row. This also restores
   bucket/hour-block reversal for free (the whole reason the core exists — see its header comment at
   `timeEntryWriteCore.ts:660-676`).
6. **Recalculate project-task hours** from the `project_task` rows among the locked set (preserve the
   existing `recalculateProjectTaskActualHours` call, now fed from the already-fetched rows filtered
   by `work_item_type === 'project_task'`), and **publish `TIME_ENTRY_DELETED`** per deleted row as
   `deleteTimeEntry` does (`timeEntryCrudActions.ts:701-707`) — currently `deleteWorkItem` emits no
   search event, leaving the index stale.

Scoping deletion to `time_sheet_id` (not `work_item_type`) is the correct restriction: it matches the
UI's intent ("remove this work item from *this* timesheet") and cannot spill into other users'
sheets or other periods. Type is handled naturally because each row is deleted individually with its
own type.

### 2b. Caller update

`TimeSheet.tsx:912`: pass the sheet id — `await deleteWorkItem(workItemId, timeSheet.id)`. Both
values are already in scope.

### 2c. Seam / type propagation

- `nativeTimeSource.ts:66` wires `removeWorkItem` via `lazy(workItemActions, 'deleteWorkItem')`; its
  type `TimeSourceMethod<typeof deleteWorkItem>` (`timeSource.ts:162`) derives from the action
  signature, so the new parameter propagates automatically.
- Update the delegate call inside `deleteWorkItem` (`timeEntryWorkItemActions.ts:252`) to forward the
  new arg: `source.sheets.removeWorkItem(ctx, workItemId, timeSheetId)`. The native source is the only
  implementation (confirmed by grep); no non-native time source implements `removeWorkItem`.

### 2d. Is a shared helper the right home?

Yes — and it already exists. The recurrence guard here is that *any* multi-row time-entry delete must
apply the owner + invoiced guard and reverse billing. The fix deliberately **routes `deleteWorkItem`
through the existing `deleteTimeEntryCore` engine** rather than adding a parallel guarded-delete, so
there is exactly one place that knows how to delete a time entry safely. No new abstraction is
warranted: `deleteTimeEntryCore` + the `assertCanActOnBehalf`/invoiced guard already *is* the shared
mechanism; the bug was a caller that went around it. (This matches the repo's "reuse the engine, don't
special-case the application" standard.)

---

## 3. The proof (tests to add)

Add a unit test file `packages/scheduling/tests/timeEntryWorkItemActions.deleteWorkItem.authz.test.ts`,
following the mocked-boundary pattern in
`packages/scheduling/tests/availabilitySettingsActions.permission.test.ts` (mock `@alga-psa/db`,
`@alga-psa/auth`, and `./timeEntryDelegationAuth` / `../src/lib/timeEntryWriteCore`; drive a captured
knex query-builder stub). Each assertion below fails against the current code.

1. **Rejects deleting another user's entries (the core authz regression).**
   Caller `user-finance` (owner of the mocked `time_sheets` row is `user-victim`). Mock
   `assertCanActOnBehalf` to throw `Permission denied: Cannot access other users time sheets` for a
   non-owner subject. Assert `deleteWorkItem(workItemId, timeSheetId)` returns/throws the permission
   error **and that no `.delete()` and no `deleteTimeEntryCore` call occurred**.
   *Fails before the fix:* current code never calls `assertCanActOnBehalf` and unconditionally deletes.

2. **Refuses invoiced rows.** Owner matches caller; one locked row has `invoiced: true`. Assert the
   call surfaces `...already been invoiced...` and deletes nothing (transaction rolls back).
   *Fails before the fix:* current code deletes invoiced rows with no check.

3. **Scopes the delete to the given timesheet and work item.** Owner matches caller, two rows on the
   target sheet. Assert the query issued against `time_entries` carries **both** `work_item_id` and
   `time_sheet_id` predicates, and that each row is removed via `deleteTimeEntryCore` (so billing
   reversal runs) rather than a raw bulk `.delete()`.
   *Fails before the fix:* current delete filters on `work_item_id` only and never calls the core.

4. **Still enforces the coarse permission.** `hasPermission('time_entry','delete')` → false yields the
   existing `Permission denied: Cannot delete work items...` error with no DB writes.
   *Passes before and after* — guards against regressing the check that already exists.

5. **(Static contract, optional, matching `timeDelegationSweep.contract.test.ts`.)** Assert
   `timeEntryWorkItemActions.ts` source contains `assertCanActOnBehalf(user, tenant, timeSheet.user_id`
   and routes through `deleteTimeEntryCore`, pinning the enforcement point against future drift.

If integration coverage is preferred over mocked-boundary unit tests, an alternative is a
seeded-tenant integration test (two users, one shared project task, invoiced + non-invoiced entries)
asserting a `time_entry:delete`-only, non-approver caller cannot erase the coworker's/invoiced rows;
the unit tests above are the minimum that "fails without the fix."

---

## 4. Scope not covered / risks for the reviewer

**Deliberately out of scope**

- **The misleading name `deleteWorkItem`.** It only deletes time entries, never the ticket/project
  task itself (see its own comment at `timeEntryWorkItemActions.ts:267-269`). This fix does not change
  that semantics or rename it.
- **`addWorkItem`'s suspicious `service_catalog` insert** (`timeEntryWorkItemActions.ts:218-232`,
  flagged by its own comments) — unrelated to this authz finding; leave it.
- **Broader timesheet-state gating** (e.g. forbidding deletion from an already-APPROVED sheet). The UI
  already restricts the control to DRAFT/CHANGES_REQUESTED (`TimeSheet.tsx:988`); server-side
  enforcement of sheet status is a separate hardening item, not this finding.
- **The pre-existing unstaged `package-lock.json` change** is left untouched.

**Risks / regressions to weigh**

- **Signature change is a breaking API change** to `deleteWorkItem`. Mitigated: the UI is the only
  caller and the time-source type derives from the signature, but the reviewer should confirm no
  out-of-tree/EE caller invokes it positionally with a single argument.
- **Behavioral change for legitimate bulk removal.** If any real workflow relied on `deleteWorkItem`
  clearing a work item across *multiple* timesheets/periods at once, scoping to one `time_sheet_id`
  changes that. Evidence says the only caller is the single-sheet UI, so this is a correction, not a
  feature loss — but call it out.
- **Now-enforced invoiced guard** means a work item with any invoiced entry can no longer be
  wholesale-deleted; users will see a per-row error. This is the intended, correct behavior (parity
  with `deleteTimeEntry`), but it is a user-visible change.
- **Billing reversal now runs** on this path. Positive for correctness, but it exercises
  `adjustTimeSpanDraw` / `reverseTimeEntryAllocations`, so the reviewer should confirm no
  double-reversal when a work item is deleted immediately after individual entry deletes (the core is
  the same engine `deleteTimeEntry` uses, so behavior matches).
- **Per-row loop cost.** Deleting many entries now iterates `deleteTimeEntryCore` instead of one bulk
  statement. Acceptable for a per-timesheet, per-work-item set; not a hot path.
