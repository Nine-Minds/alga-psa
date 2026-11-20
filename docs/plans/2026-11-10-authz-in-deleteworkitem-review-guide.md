# Human review guide: authz in `deleteWorkItem`

## Finding and repair

**Confirmed, high severity:** the original `deleteWorkItem(workItemId)` path removed every tenant time-entry row matching a work-item ID. It did not check sheet ownership, invoiced state, sheet scope, or work-item type, and it bypassed billing reversal. The original finding and attacker path remain documented in [the fix plan](./2026-11-10-authz-in-deleteworkitem-fix-plan.md#1-the-defect-precisely).

The repair keeps authorization and billing protections in the shared delete core. The action checks the selected sheet owner, locks rows in deterministic order, and passes each matching row through `deleteTimeEntryCore`. The core applies the owner and invoiced guards, reverses bucket usage and hour-block allocations in the same transaction, and removes the entry. A protected row rolls back earlier work in the group.

## Start here: real-core billing evidence

Review [`timeEntryWorkItemDeletionBilling.integration.test.ts`](../../server/src/test/integration/timeEntryWorkItemDeletionBilling.integration.test.ts) first. It uses a migrated PostgreSQL database and the real action, transaction, deletion core, bucket draw service, and hour-block reversal service. It does not mock the deletion core or billing effects.

The seven persisted-state cases establish that:

- selected entries are deleted, their bucket usage returns to zero, their hour-block allocation rows disappear, and the block balance is restored;
- coworkers' entries sharing the same work item, entries on another sheet, and entries for another work item survive with their allocations and billing balances unchanged;
- a caller with only `time_entry:delete` cannot delete a coworker's sheet, and an unauthorized entry owner on the selected sheet rolls back the whole group, including earlier billing reversals;
- a caller with `time_entry:delete`, `time_sheet:approve`, and `time_sheet:read_all` can delete the selected coworker's entries while preserving the unselected sheet;
- repeating or concurrently racing the same delete reverses each allocation only once;
- when an invoiced row stops a grouped deletion after an earlier row was processed, both entries and both billing ledgers return to their original state.

The check logs and controlled mutations are in `/home/robert/.alga-xo/reviews/3ca79fa1-35a8-5a7d-bf6d-0af0ba94a76e/`: `delete-work-item-billing-integration-verified.log`, `delete-work-item-billing-mutation.log`, and `delete-work-item-hour-block-mutation.log`. Disabling the bucket reversal made the bucket usage assertion fail. Disabling only the hour-block reversal made the persisted block-balance assertion fail. The shared core was restored after both checks.

Run the suite from `server` against the isolated integration database:

```sh
TEST_DB_NAME=deleteworkitem_authz_test \
  DB_HOST=127.0.0.1 DB_PORT=5472 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user \
  npx vitest run src/test/integration/timeEntryWorkItemDeletionBilling.integration.test.ts --coverage.enabled=false
```

The expanded suite passes 7/7. Temporarily restoring only `timeEntryWorkItemActions.ts` from merge `e75baf12b5` makes all seven cases fail on runtime assertions: unauthorized deletes succeed, unrelated entries disappear, and bucket usage remains drawn. The fixed action was restored after the check. The authentication wrapper and permission lookup are controlled test inputs; sheet lookup, entry-owner delegation checks, authorization bundle evaluation, transactions, deletion, and billing services run without mocks.

## Security and type evidence

[`timeEntryWorkItemActions.deleteWorkItem.authz.test.ts`](../../packages/scheduling/tests/timeEntryWorkItemActions.deleteWorkItem.authz.test.ts) retains the focused owner/delegation, sheet/item/type scope, invoiced rejection, coarse permission, and allowed-delete cases. It passes 5/5. Its database, event, and deletion-core boundaries are mocked; use the real-core integration suite above for billing behavior.

The required scheduling typecheck passes with `npm run typecheck` from `packages/scheduling`. The Nx scheduling build target passes; the package's direct `npm run build` script is not configured with tsup inputs and exits with “No input files,” so it is not the package build target. Logs are saved in the same review artifact directory as `scheduling-typecheck-repair.log` and `scheduling-nx-build-repair.log`.

Repeat the focused authorization suite from `packages/scheduling` with:

```sh
npx vitest run tests/timeEntryWorkItemActions.deleteWorkItem.authz.test.ts --coverage.enabled=false
npm run typecheck
```

The latest implementation checks are recorded as `implement-integration.log` (7 passed), `implement-authz.log` (5 passed), `implement-typecheck.log` (exit 0), and `implement-vulnerable-action.log` (7 expected failures) in the review artifact directory above.

Revalidated on 2026-11-20 against implementation commit `9413447d2377fa9d296c8a5996d15e80954301d3`. All three commands exited 0:

| Working directory | Command | Result | Full output in the review artifact directory |
| --- | --- | --- | --- |
| `server` | `TEST_DB_NAME=deleteworkitem_hand3_test DB_HOST=127.0.0.1 DB_PORT=5472 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user npx vitest run src/test/integration/timeEntryWorkItemDeletionBilling.integration.test.ts --coverage.enabled=false` | 7 passed; no skipped tests | `hand3-integration.log` |
| `packages/scheduling` | `npx vitest run tests/timeEntryWorkItemActions.deleteWorkItem.authz.test.ts --coverage.enabled=false` | 5 passed; no skipped tests | `hand3-authz.log` |
| `packages/scheduling` | `npm run typecheck` | `tsc --noEmit`, exit 0 | `hand3-typecheck.log` |

The isolated database name above keeps this run separate from other checkouts. The existing implementation and behavioral tests required no further changes during revalidation. Browser validation was not repeated in this run.

Implementation references:

- [Action validation, permission, sheet lookup, delegation, locked selection, and core calls](../../packages/scheduling/src/actions/timeEntryWorkItemActions.ts#L250-L315).
- [Shared deletion core and billing reversal](../../packages/scheduling/src/lib/timeEntryWriteCore.ts#L677-L755).
- [Ordinary single-entry deletion guard](../../packages/scheduling/src/actions/timeEntryCrudActions.ts#L665-L674).
- [Delegation rule](../../packages/scheduling/src/actions/timeEntryDelegationAuth.ts#L76-L95).
- [Timesheet UI call](../../packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx#L910-L923).

## Earlier live demonstrations

The existing walkthrough and SQL snapshots show selected-sheet UI deletion, coworker/other-period preservation, and invoiced rejection. Those fixtures contain no billable service or contract allocations. They do not demonstrate billing reversal; the integration suite above supplies that evidence. The live demonstrations also did not exercise a Finance impersonation, delegated deletion, or lock contention.

## Plan reconciliation and review decision

The fix plan remains the primary security specification. Its initial status (“No fix exists on this branch yet”) and proposed mocked-core test list predate the implementation and this repair. The current action also carries a third `workItemType` argument from the UI and scopes the locked query to that type, while the plan’s original signature describes only the work-item and sheet IDs. This additional scope matches the selected UI item and is covered by the retained security suite.

Captain approval remains a separate gate. Start with the real-core billing test and its persisted assertions, then inspect the scheduling typecheck log. Review the implementation references and earlier UI evidence after those checks. No additional AI verification is required.
