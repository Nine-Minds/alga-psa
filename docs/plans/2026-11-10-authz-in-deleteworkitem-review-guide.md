# Human review guide: authz in `deleteWorkItem`

## Finding

**Confirmed, high severity:** the pre-fix `deleteWorkItem(workItemId)` path removed every tenant time-entry row matching a work-item ID. It did not check the sheet owner/delegation, invoiced state, sheet, or work-item type, and it bypassed billing reversal. The approved plan records the original vulnerable implementation and attacker path in [the fix plan](./2026-11-10-authz-in-deleteworkitem-fix-plan.md#1-the-defect-precisely).

The original action’s coarse permission and tenant-wide `where({ work_item_id: workItemId }).delete()` are shown in the plan’s recorded baseline at lines 16–35. The established protections are visible in [the ordinary delete action](../../packages/scheduling/src/actions/timeEntryCrudActions.ts#L665-L674), [the shared delete core](../../packages/scheduling/src/lib/timeEntryWriteCore.ts#L677-L699), and [the delegation rule](../../packages/scheduling/src/actions/timeEntryDelegationAuth.ts#L76-L95).

## Implementation evidence

- [Action signature, validation, coarse permission, sheet lookup, and delegation check](../../packages/scheduling/src/actions/timeEntryWorkItemActions.ts#L250-L281).
- [Locked, tenant-scoped row selection by work item, type, and sheet; per-entry shared-core deletion with ownership and invoiced guards](../../packages/scheduling/src/actions/timeEntryWorkItemActions.ts#L283-L313).
- [Post-commit deletion event publication](../../packages/scheduling/src/actions/timeEntryWorkItemActions.ts#L315-L331).
- [Timesheet UI passes the selected sheet and item type](../../packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx#L910-L923); the grid preserves the chosen type through confirmation in [TimeSheetTable](../../packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetTable.tsx#L277-L289).

## Behavioral regression evidence

[`timeEntryWorkItemActions.deleteWorkItem.authz.test.ts`](../../packages/scheduling/tests/timeEntryWorkItemActions.deleteWorkItem.authz.test.ts) exercises denial without delegation, selected-sheet/item/type scope, invoiced rejection after an earlier row has been attempted, coarse permission enforcement, and authorized uninvoiced deletion. The rollback assertion verifies the entire entry set remains after rejection.

Run from `packages/scheduling`:

```sh
npx vitest run tests/timeEntryWorkItemActions.deleteWorkItem.authz.test.ts
npm run typecheck
```

## Review steps

1. Inspect the action selection predicates and confirm `tenantDb` plus `FOR UPDATE` keep reads tenant-scoped and stable during the transaction.
2. Confirm each selected row passes through `deleteTimeEntryCore` and its guard, so a rejection rolls back earlier rows and billing reversal stays in the shared path.
3. Check the UI call sends the current sheet ID and exact work-item type.
4. Run the focused regression suite and scheduling typecheck above.
5. Captain approval remains required. Review the public action signature change for out-of-tree callers; the in-repository native time-source seam derives its type from the action.
