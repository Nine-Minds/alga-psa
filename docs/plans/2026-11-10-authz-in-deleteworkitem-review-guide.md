# Human review guide: authz in `deleteWorkItem`

## Finding and repair

**Confirmed, high severity:** the original `deleteWorkItem(workItemId)` path removed every tenant time-entry row matching a work-item ID. It did not check sheet ownership, invoiced state, sheet scope, or work-item type, and it bypassed billing reversal. The original finding and attacker path remain documented in [the fix plan](./2026-11-10-authz-in-deleteworkitem-fix-plan.md#1-the-defect-precisely).

The repair keeps authorization and billing protections in the shared delete core. The action checks the selected sheet owner, locks rows in deterministic order, and passes each matching row through `deleteTimeEntryCore`. The core applies the owner and invoiced guards, reverses bucket usage and hour-block allocations in the same transaction, and removes the entry. A protected row rolls back earlier work in the group.

## Start here: real-core billing evidence

Review [`timeEntryWorkItemDeletionBilling.integration.test.ts`](../../server/src/test/integration/timeEntryWorkItemDeletionBilling.integration.test.ts) first. It uses a migrated PostgreSQL database and the real action, transaction, deletion core, bucket draw service, and hour-block reversal service. It does not mock the deletion core or billing effects.

The four persisted-state cases establish that:

- selected entries are deleted, their bucket usage returns to zero, their hour-block allocation rows disappear, and the block balance is restored;
- entries on another sheet or work item survive with their allocations and billing balances unchanged;
- repeating or concurrently racing the same delete reverses each allocation only once;
- when an invoiced row stops a grouped deletion after an earlier row was processed, both entries and both billing ledgers return to their original state.

The check logs and controlled mutations are in `/home/robert/.alga-xo/reviews/3ca79fa1-35a8-5a7d-bf6d-0af0ba94a76e/`: `delete-work-item-billing-integration-verified.log`, `delete-work-item-billing-mutation.log`, and `delete-work-item-hour-block-mutation.log`. Disabling the bucket reversal made the bucket usage assertion fail. Disabling only the hour-block reversal made the persisted block-balance assertion fail. The shared core was restored after both checks.

Run the suite from `server` against the isolated integration database:

```sh
DB_HOST=127.0.0.1 DB_PORT=5472 DB_USER_ADMIN=postgres DB_USER_SERVER=app_user \
  npx vitest run src/test/integration/timeEntryWorkItemDeletionBilling.integration.test.ts --coverage.enabled=false
```

## Security and type evidence

[`timeEntryWorkItemActions.deleteWorkItem.authz.test.ts`](../../packages/scheduling/tests/timeEntryWorkItemActions.deleteWorkItem.authz.test.ts) retains the focused owner/delegation, sheet/item/type scope, invoiced rejection, coarse permission, and allowed-delete cases. It passes 5/5. Its database, event, and deletion-core boundaries are mocked; use the real-core integration suite above for billing behavior.

The required scheduling typecheck passes with `npm run typecheck` from `packages/scheduling`. The Nx scheduling build target passes; the package's direct `npm run build` script is not configured with tsup inputs and exits with “No input files,” so it is not the package build target. Logs are saved in the same review artifact directory as `scheduling-typecheck-repair.log` and `scheduling-nx-build-repair.log`.

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
