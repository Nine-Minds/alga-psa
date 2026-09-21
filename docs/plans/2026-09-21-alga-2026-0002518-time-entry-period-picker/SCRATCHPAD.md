# Working notes

- Ticket: alga-2026-0002518.
- Code inspected at `2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04` on 2026-09-21.
- Design artifacts live under `docs/plans/` as commissioned. This overrides the alga-plan skill's default `ee/docs/plans/` location.
- The commissioning order supplies scope and authorizes a committed plan. Application implementation remains pending.
- Existing unrelated change: `package-lock.json`. Exclude it from the plan commit.
- Initial Git status failed with ENOSPC. The worktree is on `/home/robert/alga-copies`, a separate btrfs filesystem backed by `/dev/loop0`; root filesystem had free space. A later check showed 505 MB available and plan directory creation succeeded. No storage cleanup or host reconfiguration was performed.

## Findings

- `packages/scheduling/src/lib/timeEntryLauncher.tsx` resolves today's period even for existing entries; new entries use its sheet, and every dialog receives `isEditable={true}`.
- `packages/scheduling/src/actions/timeSheetOperations.ts::fetchTimePeriods` already returns tenant-scoped periods with the subject user's sheet ID/status, newest first. Missing sheets appear as DRAFT. Reuse this instead of combining all periods with a new status query.
- `fetchOrCreateTimeSheet` returns the actual sheet status and full period. It may create a DRAFT sheet; do not call it for every picker option.
- `TimeEntryEditForm.tsx` uses date-only local parsing and end-minus-one-day bounds. `saveTimeEntry` validates both endpoints against `[start_date, end_date)` in the subject user's timezone.
- The inspected save action has permission, ownership, invoice, and period checks, but no sheet editability check. Add a guard at the write transaction for the flow to respect status after the picker opens.
- `TimeEntryDialog` treats a fulfilled `onSave` as success. The launcher catches errors and returns, allowing a false success toast and close. Propagate failures from the launcher callback.
- `TimeEntryProvider.initializeEntries` prefers explicit default start/end timestamps to the base date. Merely changing `date` cannot rebase timer defaults to an earlier period.
- The launcher is supplied by `SchedulingProviderWithCallbacks`, so changes also reach project and other work-item callers.

## Decisions

- Use a period-selection stage in the existing drawer, with current period preselected and Continue resolving one sheet. Keep selection outside the entry provider so choosing a period cannot discard typed entry values or leave an old sheet ID attached to a new period.
- Show locked periods with status; allow selection to explain the restriction, but disable Continue. Do not silently choose another period when today's sheet is locked.
- If no current period exists but others do, leave selection empty and permit explicit selection. Only an empty catalog blocks all new entry launches.
- Preserve existing-entry edits on their saved sheet and actual period; never offer sheet transfer.
- Small plan estimate: 12 observable features and 8 representative tests. No runtime code or tests are implemented during design.
- User profiles expose optional `timezone`, but the server's resolved timezone also handles fallback. Plan a narrow authenticated timezone accessor reusing `resolveUserTimeZone`, so browser defaults follow the same subject timezone as period membership checks.

## Design validation

- `python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py docs/plans/2026-09-21-alga-2026-0002518-time-entry-period-picker` passed: 12 features, 8 tests, valid references.
- `git diff --check` passed. Application tests were not run because this change contains design artifacts only.
