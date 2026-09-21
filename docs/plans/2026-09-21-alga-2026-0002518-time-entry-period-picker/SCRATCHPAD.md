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

## Implementation and takeover validation (2026-09-21)

- Builder commits implement the shared period picker, saved-sheet anchoring, transactional sheet-status guards, localization, and subject-timezone form controls. The integration suite now creates a separate bucket client per test and resets its authenticated actor before each case, avoiding shuffled-order contamination.
- The final review found a remaining mismatch: `TimeEntryDialog` called browser-local `validateTimeEntry` even when the form used the subject timezone. In a UTC browser, Auckland 11:30–12:30 crosses browser midnight and was incorrectly rejected; Auckland 23:30–00:30 was incorrectly accepted. The final save validator now accepts the same optional `workTimeZone` as the form. Callers omitting it retain browser-local behavior.
- Three real-dialog Save regressions cover those two cases and the omitted-timezone fallback. The first two failed before the repair and pass afterward. Existing save-adapter tests verify returned action errors and thrown exceptions retain typed values without completion, closure, or success feedback.
- The rebased-default warning formats the selected period's first calendar date rather than an instant, so browsers west of the subject timezone do not show the previous day in its explanation.
- Verification during takeover: full scheduling suite (71 files / 398 tests); scheduling and UI `tsc --noEmit`; translation validator (9 locales, no errors); DB integration (8 tests) plus real-form date-field suite (5 tests), each passing with `VITEST_SEED=1789967777652` and `42`. Tests run against isolated `test_period_picker_review_2518` on local Postgres port 5472, not the application database. Test credentials come from the worktree's `secrets/` files and must not be printed.
- Builder reported browser smoke on port 3518 for prior-period persistence, ticket refresh, locked/no-current states, keyboard selection, light/dark themes, and Cancel/relaunch. Takeover did not repeat those browser checks. Current-period default has automated coverage only because no current period existed in the smoke data. True concurrent submission versus save has not been exercised; stale status and transactional guard cases have DB-backed coverage.
- Keep the unpublished draft local: no push or PR. Preserve the unrelated `package-lock.json` modification outside the task commit.
