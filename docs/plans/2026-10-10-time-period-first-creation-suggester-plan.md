# Plan: the first time period is created on any day, not only the start day (#3206)

Card: #3206 (GitHub Nine-Minds/alga-psa#3206, items 1 and 2). Grounded in `origin/main` @ b0d0b4dacf.

## Problem

A tenant that saves time period settings (for example weekly, Sunday start) gets no time
periods. Time entry then fails ("No time periods are set up yet…" in the launcher, "No active
time period found" in interval tracking and on tickets), and the Create New Time Period dialog
shows "No applicable time period settings found" unless the user ticks "Override suggested dates".

### Root cause

`TimePeriodSuggester.suggestNewTimePeriod` (`packages/scheduling/src/lib/timePeriodSuggester.ts`)
works in two steps:

1. It picks a candidate start date: today (`Temporal.Now.plainDateISO()`, server/browser zone)
   when no periods exist, otherwise the latest `end_date`.
2. It keeps a setting only if that date's weekday (week) or day of month (month/year) falls in
   `[start_day, end_day]`, with `end_day = 0` mapped to 7 or `daysInMonth`.

So, with no periods yet, the start date is always *today*, and a setting applies only when today
happens to sit in the range:

- Weekly, Sunday start, end of week (`start_day 7`, `end_day 0 → 7`): applies on Sundays only.
- Weekly, Sunday start, Saturday end (`start_day 7`, `end_day 6`): the range `7..6` is empty, so
  the setting never applies.
- Monthly with a wrapped range (for example 15th to 14th): also never applies.

The nightly job (`create-next-time-periods`, 00:30 UTC; `server/src/lib/jobs/tenantPeriodMaintenance.ts`
→ `createNextTimePeriod` in `packages/scheduling/src/actions/timePeriodsActions.ts`) creates the
first period through the same call (`suggestNewTimePeriod(settings, [])`). It succeeds only on a
night whose UTC date is the start day, and never for a wrapped range. Even when it succeeds, the
period starts on the night of the run, so the partial week before it is never covered.

`effective_from` has nothing to do with this. The suggester never reads it.

The same weekday test also blocks *subsequent* periods. If the latest `end_date` is off the
configured grid (a manually created period, or settings changed from Monday weeks to Sunday weeks),
the test fails every night, and the tenant stops getting periods with no visible error.

### Other defects found in the same code (fixed here because the fix touches them)

- The suggester reads "today" from the process's zone. The nightly job has its own UTC
  `currentDate` but cannot pass it in, so the two can disagree near midnight.
- The suggester ignores `effective_from` and `effective_to`, and ignores `frequency` for
  `month`.
- The `month` arm contains an unreachable branch (`endDate.month === startDate.month` after adding
  a month).
- `createNextTimePeriod` checks the threshold against `latestEndDate`, not against the start the
  suggester actually returns, and the bootstrap path skips the threshold check altogether.

## Design

### 1. One rule: the period containing a date

Replace the weekday-range filter with a per-setting **grid**. Every setting defines an infinite
sequence of period *cells*. For a target date `D`, the suggester asks each setting for its cell
containing `D`. The first setting that has one wins. Settings arrive ordered
`effective_from desc`, as `TimePeriodSettings.getActiveSettings` returns them.

New pure functions in `packages/scheduling/src/lib/timePeriodSuggester.ts` (exported for tests):

```ts
/** Is the setting in force on date D? effective_from <= D <= effective_to (date parts). */
isSettingEffectiveOn(setting, D): boolean

/** Most recent grid boundary on or before D. Null if the setting has no boundary <= D. */
alignedPeriodStart(setting, D): Temporal.PlainDate | null

/** Exclusive end of the cell that starts at boundary B. */
cellEnd(setting, B): Temporal.PlainDate

/** The cell containing D: { start: max(B, effective_from), end }, or null. */
periodContaining(setting, D): { start; end } | null
```

Grid per frequency unit. The **phase anchor** for `frequency > 1` is the most recent natural
boundary on or before `effective_from`. A frequency of 1 has no phase, so the anchor matters
only for multi-unit frequencies.

| unit | natural boundary | cell end (exclusive), from boundary B | notes |
|---|---|---|---|
| `day` | every day; phase anchored at `effective_from` | `B + frequency days` | unchanged length |
| `week` | ISO weekday `start_day` (1 = Mon … 7 = Sun) | `B + frequency weeks` | `end_day` is not consulted. A weekly period always runs to the day before the next start boundary, so "end of week" (`0`), a wrapped range (Sun→Sat) and a plain range all produce the same cells. This matches the current length arm. |
| `month` | day `min(start_day, daysInMonth)` of each month | `end_day = 0`: first day of month `B.month + frequency`. `end_day >= start_day`: day `min(end_day, dim)` of month `B.month + frequency - 1`, plus 1 day. `end_day < start_day` (wrapped): day `min(end_day, dim)` of month `B.month + frequency`, plus 1 day. | `end_day` is inclusive and stored as exclusive `+1`, which is the suggester's existing convention. A cell can stop short of the next boundary (semi-monthly settings `1–15` plus `16–EOM`), and that is how two settings share a month. |
| `year` | `start_month` / `start_day_of_month` (default Jan 1 when unset) | `B + frequency years` | unchanged length |

`D` is in the cell iff `cellStart <= D < cellEnd`. Storage stays half-open `[start, end)`.

Applicability is now the question "does this setting have a cell containing D?" For the
semi-monthly pair on the 20th, `1–15` has cell `[1st, 16th)`, which does not contain the 20th,
and `16–EOM` has `[16th, 1st)`, which does. The month window test therefore keeps its meaning,
and it can no longer be fooled by wrap-around or by the weekday.

### 2. `suggestNewTimePeriod(settings, existingPeriods, options?)`

New optional third parameter `{ today?: Temporal.PlainDate | string }`. It defaults to
`Temporal.Now.plainDateISO()`, so the dialog keeps its current behaviour in the browser's zone.
Existing callers compile unchanged.

- **Bootstrap (no periods):** `D = today`. Use the first setting with `periodContaining(s, D)`.
  The result is the *current* period, aligned back to the most recent boundary and clamped to
  `effective_from`. Weekly Sunday start on a Wednesday gives last Sunday → next Sunday.
- **Subsequent (periods exist):** `D = latest end_date`. Use the first setting with a cell
  containing `D`, and return `{ start: D, end: cell.end }`. When the latest period ended off the
  grid, this produces one short *bridging* period that rejoins the grid instead of stalling for
  ever.
- **No cell contains D:** fall back to the earliest cell, across all settings, that **starts after
  `D`**, searching a bounded horizon of 2 × the longest setting cycle (at most about 2 years). This
  covers two cases:
  - `effective_from` is in the future: the first period begins at `effective_from` (clamped).
  - A gap in the settings (a lone `1–15` setting with `D` on the 16th): skip to the next 1st.

  Only if nothing exists within the horizon does it return
  `errorKey: timeEntry.periods.errors.noApplicableSettings`.
- `period_id` and `tenant` stay as they are today (latest period's id, or a uuid). The `month`
  dead branch is removed.

`calculateEndDate` (the dialog's manual-start recompute) is **not** changed. It belongs to the
stacked inclusive/exclusive card (issue item 3).

### 3. Nightly job: `createNextTimePeriod`

`createNextTimePeriod(settings, daysThreshold = 5, options?: { today?: Temporal.PlainDate })`.
The default for `today` stays `getCurrentDate('UTC')`.

- Pass `{ today: currentDate }` into every `suggestNewTimePeriod` call, so job and suggester agree
  on the date.
- Bootstrap: call the suggester and **create only if `suggestion.start - today <= daysThreshold`**.
  The current period always passes, because its start is ≤ today. A future `effective_from` waits
  until it falls inside the threshold.
- Gap-fill loop: call the suggester first, then apply the threshold to **`suggestion.start_date`**
  rather than `latestEndDate`, because a gap-skip can move the start forward.
- Take `pg_advisory_xact_lock(hashtext('time-periods:' || tenant))` at the top of the transaction
  so the nightly job and the on-demand path (§4) cannot interleave. This follows the pattern in
  `billing/models/userCostRate.ts`. The overlap check in `createTimePeriodWithTrx` stays as a
  backstop.
- `MAX_PERIODS_PER_RUN`, logging and the return value are unchanged.

`tenantPeriodMaintenance.createNextTimePeriodForTenant` needs no change: it already passes the
active settings, and the fix lives below it.

The dialog (`TimePeriodForm.tsx`, `SET_SUGGESTION`) needs no code change either. It calls
`suggestNewTimePeriod(settings, modelPeriods)` and now gets the current period on any day.

### 4. On-demand creation of the current period (decision)

**Decision: yes. Time entry reads materialize the current period when settings exist and no
period covers the user's today. This happens server-side at the read chokepoints, not in each UI
caller.**

Reasoning:

- Periods are fully determined by admin-configured settings, so materializing one is not a user
  decision. The nightly job does the same thing, just later. Making users wait until 00:30 UTC (or
  for a whole week, before this fix) has no upside.
- Doing it at the read chokepoints covers the web launcher, the time sheet list, interval
  tracking, tickets, the REST API and mobile, all at once. Putting it in each component would
  miss callers.
- It is idempotent and cheap when a period already exists: a single indexed `findByDate` query
  before any write.

Implementation:

- New internal helper in `timePeriodsActions.ts` (not a server action):
  ```ts
  export async function ensureTimePeriodCoversDate(
    knex: Knex, tenant: string, date: Temporal.PlainDate
  ): Promise<void>
  ```
  1. Return if `TimePeriod.findByDate(knex, tenant, date)` finds a period (fast path).
  2. Load `TimePeriodSettings.getActiveSettings`. Return if there are none.
  3. Run the `createNextTimePeriod` core with `today = date` and `daysThreshold = 0`, under the
     tenant context, sharing the advisory lock. Bootstrap creates the cell containing `date`. If
     periods exist but end before `date`, the gap-fill loop creates periods up to the one
     containing `date`.
  4. Catch and log failures without rethrowing (an overlap from a race, for example). The read
     goes on and returns whatever exists, so a materialization failure never breaks a read.
- Refactor `createNextTimePeriod` into a core `createTimePeriodsThrough(trx, tenant, settings,
  today, daysThreshold)` plus the existing exported wrapper. The nightly job and the ensure helper
  share that core.
- Call sites, each with the date in the user's zone, the same zone `getCurrentTimePeriod`
  already uses:
  - `fetchTimePeriods` (`packages/scheduling/src/actions/timeSheetOperations.ts`): before the
    query, `ensureTimePeriodCoversDate(db, tenant, todayIn(resolveUserTimeZone(subject user)))`.
    This covers `timeEntryLauncher`, `TimeTracking`, and the ticket time-entry flow.
  - `getCurrentTimePeriod` (`timePeriodsActions.ts`): on a miss, ensure and then re-query. This
    covers `IntervalManagement` and `IntervalManagementDrawer`.
  - `TimeSheetService.getCurrentTimePeriod` (`server/src/lib/api/services/TimeSheetService.ts`):
    only when `date` is omitted or equals the server's today in UTC, ensure and then re-query.
    Arbitrary historical dates never create periods. This covers mobile and the REST API.
- Permissions: no new permission. Any authenticated time-entry caller can trigger it, because it
  only writes what the settings already dictate. The settings themselves remain admin-only.
- The "No time periods are set up yet" and "No Active Time Period" messages remain for tenants
  with **no settings**. They are still accurate there.

### 5. The second suggester copy

`server/src/lib/timePeriodSuggester.ts` is imported only by its own unit test,
`server/src/test/unit/timePeriodSuggester.test.ts`. Nothing in production uses it.
**Delete both.** Before deleting, port any assertions in that test that still hold under the new
rules into `packages/scheduling/tests/timePeriodSuggester.test.ts`, and drop the ones that encoded
the today-dependent behaviour.

## Files to change

| File | Change |
|---|---|
| `packages/scheduling/src/lib/timePeriodSuggester.ts` | Grid helpers (`isSettingEffectiveOn`, `alignedPeriodStart`, `cellEnd`, `periodContaining`). Rewrite of `suggestNewTimePeriod` with the `options.today` parameter and the containing → next-after fallback. Remove the month dead branch. `calculateEndDate` is untouched. |
| `packages/scheduling/src/actions/timePeriodsActions.ts` | `createNextTimePeriod` gains `options.today`, the advisory lock, the bootstrap threshold, and the threshold applied to the suggested start. Extract `createTimePeriodsThrough` core. New `ensureTimePeriodCoversDate`. `getCurrentTimePeriod` ensures on a miss. |
| `packages/scheduling/src/actions/timeSheetOperations.ts` | `fetchTimePeriods` calls `ensureTimePeriodCoversDate` for the subject user's today. |
| `server/src/lib/api/services/TimeSheetService.ts` | `getCurrentTimePeriod` ensures on a miss when the target is today. |
| `server/src/lib/timePeriodSuggester.ts` | Delete. |
| `server/src/test/unit/timePeriodSuggester.test.ts` | Delete after porting the still-valid cases. |
| `packages/scheduling/tests/timePeriodSuggester.test.ts` | New unit tests (below). Update the existing "returns an error when no applicable setting matches" test: under the bridging rule it now yields a Monday→Sunday bridging period. |
| `server/src/test/infrastructure/time-periods/timePeriods.test.ts` | DB tests for bootstrap on a non-start day, the bootstrap threshold, and `ensureTimePeriodCoversDate`. |

No migrations and no settings-UI changes. Existing locale keys stay in use, so no locale changes
either.

## Tests

### Unit tests: `packages/scheduling/tests/timePeriodSuggester.test.ts`

All tests pass `options.today` explicitly, so none depend on the clock.

1. Weekly, Sunday start, `end_day 0`, no periods. Run once for `today` on each of Sun 2026-10-04
   … Sat 2026-10-10. Every run gives `[2026-10-04, 2026-10-11)`.
2. Wrapped weekly range: Sunday start, Saturday end (`7`/`6`), today Wed 2026-10-07 →
   `[2026-10-04, 2026-10-11)`.
3. Weekly, Monday start, today Monday → starts today, so an aligned date is unchanged.
4. Monthly mid-month: `start_day 1`, `end_day 0`, today 2026-10-17 → `[2026-10-01, 2026-11-01)`.
5. Semi-monthly pair (`1–15`, `16–0`): today the 20th → `[16th, 1st next)`. Today the 3rd →
   `[1st, 16th)`. Latest end on the 16th → `[16th, 1st)`.
6. Wrapped monthly range: `start_day 15`, `end_day 14`, today the 3rd → `[15th prev, 15th)`.
7. `start_day 31` in February clamps to Feb 28/29.
8. `effective_from` after the aligned start: weekly Sunday, `effective_from` Wed 2026-10-07,
   today Fri 2026-10-09 → `[2026-10-07, 2026-10-11)`. The partial first period ends on the grid.
9. `effective_from` in the future: today 2026-10-09, `effective_from` 2026-10-20 → the first cell
   starting on 2026-10-20 (clamped).
10. Biweekly: phase is anchored at `effective_from`'s week, and the bootstrap picks the cell
    containing today.
11. Subsequent period on the grid: latest end Sunday → next full week (regression for the
    existing test 1).
12. Subsequent period off the grid: latest end Monday, Sunday-start setting → bridging
    `[Mon, Sun)`, and the next call gives a full week.
13. Gap skip: a lone `1–15` setting, latest end on the 16th → `[1st next, 16th next)`.
14. `effective_to` in the past and no other setting → `noApplicableSettings` error key.

### Integration tests: `server/src/test/infrastructure/time-periods/timePeriods.test.ts`

15. `createNextTimePeriod` **bootstraps on a non-start day**: freeze to Wed 2024-01-17, weekly
    Sunday-start setting, no periods → creates `[2024-01-14, 2024-01-21)`. The 5-day threshold
    then also creates `[2024-01-21, 2024-01-28)`.
16. Bootstrap with `effective_from` beyond the threshold creates nothing. Within the threshold, it
    creates the period.
17. `ensureTimePeriodCoversDate` with no periods creates the current period. Called a second
    time, it is a no-op. With no settings, it is a no-op.
18. `ensureTimePeriodCoversDate` with a two-week gap fills through the period containing the
    date.

Run with `npx vitest run packages/scheduling/tests/timePeriodSuggester.test.ts` and the
infrastructure suite against the wired-up `alga-psa-local-test` stack.

### Manual check

On the dev stack (`http://feature-3206-first-time-period-never-created-unless-toda.localhost:3066`):

1. Start from a tenant with no periods. Add a weekly Sunday-start setting on a non-Sunday.
2. Open Settings → Time Entry → Time Periods → Create. The dialog prefills last Sunday → next
   Sunday, with no override needed.
3. Delete that period and open time entry from a ticket. The current week's period is created
   automatically and the entry form opens.

## Risks and notes

- **`effective_from` date part.** `getActiveSettings` serializes `effective_from` as a UTC ISO
  timestamp, and the grid uses its date part, which matches `toPlainDate` elsewhere. A setting
  saved at local midnight in a UTC+ zone could read as the previous day. This only widens the
  first partial period by one day, so it is accepted as is.
- **Bridging periods change existing behaviour on purpose.** The old code stalled for ever on an
  off-grid end date. The new code creates one short period. A tenant that had stalled will get the
  bridging period on the next night or the next time entry read.
- **Out of scope:** the generator (`generateTimePeriods` / `getEndOfPeriod`) treats a month
  `end_day` as exclusive, while the suggester treats it as inclusive. That inconsistency, and the
  end-date display convention, belong to the stacked issue-item-3 card. `calculateEndDate` is
  untouched here.
- `// LEVERAGE: pattern period-grid`. `generateTimePeriods` / `alignToWeekday` / `alignToMonthDay`
  keep a second, forward-aligning grid. Once the item-3 card settles the end-day convention,
  `generateTimePeriods` should be re-expressed through `periodContaining` / `cellEnd`. Leave a
  marker at both sites rather than merging them here.
