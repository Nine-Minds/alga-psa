# Spec — time-sheet approval status is derived state (alga-2026-0003017)

Card `d6385d18` · finding from the security review of PR #3985 (merged `dedce8256173`) ·
`server/src/lib/api/services/TimeSheetService.ts#TimeSheetService.update`.

## Finding
`updateTimeSheetSchema` accepts `approval_status` (`server/src/lib/api/schemas/timeSheet.ts:51-55`) and
`TimeSheetService.update` (`:413-440`) writes `{ ...data }` into the row. The path guards ownership and
approved-sheet immutability only, so `PUT /api/v1/time-sheets/{id}` with `{"approval_status":"APPROVED"}`
approves a sheet with no `time_sheet:approve` permission, no SUBMITTED precondition, no `approved_by` /
`approved_at`, no approver comment and no propagation to `time_entries`. The dedicated `approveTimeSheet`
(`:559-613`) does all five. Two paths, one column, one meaning.

## Invariant
`time_sheets.approval_status` is **derived state, not a writable column**. Every status change runs exactly one
transition carrying (a) a capability check, (b) a from-state precondition, and (c) the side effects that give the
new state meaning. `update` may *request* a transition; it may not *assert* one.

## Mechanism — one table, three consumers
New `server/src/lib/api/services/timeSheetStatus.ts`:

| target | from | capability | side effects |
|---|---|---|---|
| `SUBMITTED` | `DRAFT`, `CHANGES_REQUESTED` | `submit-own` | `submitted_at`, `submission_notes`; requires ≥ 1 entry |
| `APPROVED` | `SUBMITTED` | `approve` | `approved_at`, `approved_by`, approver comment, propagate to `time_entries`, `assertHumanWorkOwner(..., 'approved_by')` |
| `CHANGES_REQUESTED` | `SUBMITTED` | `approve` | `change_reason`, `detailed_feedback`, comment |

- `resolveTransition(sheet, target)` → descriptor or `ConflictError` with the wording the verbs already use.
- `assertTransitionCapability(trx, sheet, descriptor, context)` — `submit-own` = owner **and**
  `hasPermission(context.user, 'time_sheet', 'update', trx)`; `approve` =
  `hasPermission(context.user, 'time_sheet', 'approve', trx)` (house pattern at `TimeSheetService.ts:1672`).
- `applyTransition(trx, sheet, descriptor, context, payload)` — row update plus side effects.

Consumers:

1. `submitTimeSheet`, `approveTimeSheet`, `requestChanges` become resolve → assert → apply plus their existing
   post-commit publish. Signatures, error messages and `bulkApprove` unchanged.
2. `TimeSheetService.update` splits `approval_status` off the payload, writes the remaining fields as today, and — if a
   different status was supplied — resolves, asserts and applies it **in the same transaction**, after the field write,
   so `{notes, approval_status}` lands atomically and a refused transition leaves the notes unapplied. Same value is a
   no-op. Any target outside the table (notably re-opening to `DRAFT`) is a `409`.
3. `canManageTimeSheets` / `canApproveTimeSheets` (`:1604-1612`) currently `return false; // Simplified for now`, which
   makes the dedicated approve path unreachable through the API. Implement both with
   `hasPermission(context.user, 'time_sheet', 'update' | 'approve', knex)`. This is the only behaviour-widening change.

Status changes are validated **before** the `delegateRest(..., 'sheets', 'update')` time-source seam: `approval_status`
means the same thing to every source, and the seam exists to let a source own the data, not to redefine a shared column.

## Tests
1. Owner PUTs `{"approval_status":"APPROVED"}` on a DRAFT sheet → 403, row unchanged, no `time_entries` touched.
2. Approver PUTs the same on a SUBMITTED sheet → 200 and a row+entry state **deep-equal** to `POST .../approve`
   (parity test; the anti-drift guard).
3. Owner PUTs `SUBMITTED` on their own DRAFT with entries → 200, `submitted_at` set; on another user's sheet → 403.
4. PUT with the current status → 200, no-op.
5. `{notes, approval_status:'APPROVED'}` on a DRAFT → 409 **and** `notes` unchanged (rollback).
6. `APPROVED` from `CHANGES_REQUESTED` → 409.

## Out of scope
`updateTimeSheetSchema` keeps accepting `approval_status` (the request is legitimate; the write was not). No new
permission verbs. `packages/scheduling/src/actions/timeSheetActions.ts` writes the column through raw knex from server
actions with its own guards — same class, separate follow-up card.
