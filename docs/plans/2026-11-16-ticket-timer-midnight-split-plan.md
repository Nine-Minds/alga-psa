# Ticket timer: sessions that cross midnight — design

Card: `f95f95ee` · "Ticket timer: stopping a late session prefills a time entry that crosses midnight and can't be saved"
Ticket: alga-2026-0003246 (Joymode Business Solutions / Munjal Thakkar)
Branch: `feature/ticket-timer-stopping-a-late-session-prefills-a`
Base at authoring time: `ac276d8e29` (all line numbers below are against this base)
Predecessor: `docs/plans/2026-10-10-split-ticket-time-tracking-plan.md` (decisions D2, D4, D5 referenced below)

## 1. Problem

A stopwatch session becomes exactly one time entry (D5). `toEntrySpan`
(`packages/scheduling/src/lib/stopwatch/stopwatchMath.ts:75-96`) sets start = first segment
start and end = start + total active minutes. `stopwatchSessionToTimeEntryContext`
(`packages/tickets/src/lib/timeEntryContext.ts:62-104`) passes that span to the drawer as
`startTime`/`endTime`. When active time counted from the first start passes the user's
midnight, the entry crosses two work days.

The drawer's save path then calls `validateTimeEntry`
(`packages/scheduling/src/components/time-management/time-entry/time-sheet/utils.ts:25-54`),
which rejects a cross-day entry with a native `alert('Time entry must end on the same day')`
(line 42), and `TimeEntryDialog.handleSaveEntry` adds the generic toast
(`TimeEntryDialog.tsx:209-212`). The time cannot be saved.

Joymode's session: first segment started 10/28 7:06 PM, 2 segments, 12h 34m active,
128h 15m paused. The prefill was 7:06 PM → 7:40 AM next day, which also hides the fact that
the second segment happened days later.

Two further facts shape the design:

- **The server does not enforce the same-day rule.** `persistTimeEntry` computes `work_date`
  from the start and only checks both ends against the sheet period
  (`packages/scheduling/src/lib/timeEntryWriteCore.ts:366-404`). The REST/mobile log path
  (`StopwatchApiService.log`, `server/src/lib/api/services/StopwatchApiService.ts:207-224`, and
  `TimeEntryService.stopTimeTracking`, `server/src/lib/api/services/TimeEntryService.ts:745-771`)
  therefore saves the same synthetic cross-midnight entry today, silently, dated on the first day.
- **Billing minimums and round-up apply per time entry.** `computeTimeBasedCharges`
  raises each entry to `minimum_billable_time` and rounds each entry up to `round_up_to_nearest`
  (`packages/billing/src/lib/billing/compute/computeTimeBasedCharges.ts:304-326`). Every extra
  entry a session produces can add up to one minimum or one round-up increment to the invoice.

## 2. Decisions

### 2.1 Split rule: one entry per work day, not one per segment

A session becomes **one entry per work day that contains active time**. Segments are cut at
each midnight in the work timezone. The pieces that fall on the same day are combined into
one entry using the D5 rule for that day:

- `start` = that day's first active instant, truncated to the minute
- `minutes` = round(that day's active ms / 60 000)
- `end` = `start + minutes`, capped at 23:59 of that day (see 2.5)

Paused time is never booked. A day with only paused time produces no entry. A session that
stays within one day produces exactly one entry, identical to today's output.

**This deliberately departs from the card's hypothesis of one entry per segment.** Reasons:

1. Acceptance criterion 3 asks that a session within one day still yields a single entry.
   Splitting per segment would break that for every paused-and-resumed session.
2. Billing applies the minimum and round-up per entry (above). If a session paused four times
   were split per segment, the invoice for the same work could gain up to four extra
   minimums or round-ups. Splitting per day only adds entries where the work really spans
   days, which is also where a time sheet needs them.
3. The time sheet, approvals and `work_date` are organised by day. A per-day entry is the
   smallest unit those surfaces need. Within a day, the D5 compaction (start + active
   minutes) keeps the reasons it was introduced: the edit form recomputes billable minutes
   from the span, so a span that included a pause would be re-billed on first edit (plan
   2026-10-10, D5).

What "matches real segment times" means here: each entry starts at the real first start on
its day and books exactly that day's active minutes. Within a day the end is compacted, as
it is today. If the captain wants per-segment entries anyway, the partition function below
already produces per-segment pieces; only the grouping step changes. Billing exposure is
recorded as risk R1.

### 2.2 Mechanism: a pure session-to-entries planner with an injected calendar

Add to `stopwatchMath.ts`:

```ts
export interface WorkDayCalendar {
  /** Work date (YYYY-MM-DD) of an instant. */
  dayOf(ms: number): string;
  /** First instant of the next work day after `ms` (the next local midnight). */
  nextDayStart(ms: number): number;
}

export interface StopwatchEntryPlanItem {
  workDate: string;
  start: Date;        // minute-truncated first active instant that day
  end: Date;          // start + minutes, capped at 23:59 that day
  minutes: number;
  activeMs: number;   // exact, before rounding
  segmentCount: number; // pieces that contributed
}

export function toEntryPlan(
  segments: readonly StopwatchSegmentLike[],
  now: StopwatchTimestamp | number,
  calendar: WorkDayCalendar,
): StopwatchEntryPlanItem[];
```

Steps:

1. Normalise: an open segment closes at `now`. Drop segments with a non-finite timestamp or
   `end <= start` (same filter as `activeMs`, `stopwatchMath.ts:39-50`).
2. Cut each segment at every `calendar.nextDayStart` boundary inside it.
3. Group the pieces by `calendar.dayOf(piece.start)`, in chronological order.
4. Apply the per-day D5 rule from 2.1. Drop days whose rounded minutes are 0. If that drops
   every day, return one 1-minute item on the first day, which keeps the existing D5
   minimum of 1 minute.
5. `toEntrySpan` stays as it is. The notice and other single-span callers keep using it.

`stopwatchMath.ts` must not import anything; it is copied byte-for-byte to
`ee/mobile/src/features/timer/stopwatchMath.ts`, and a parity test enforces that (header
comment, `stopwatchMath.ts:1-7`). The calendar is therefore injected:

- **Server and web:** `zonedWorkDayCalendar(timeZone)` in
  `packages/scheduling/src/lib/timeEntryPeriodSelection.ts`, next to `workDateInTimeZone`
  (line 35) and `instantAtZonedTime` (line 40). It uses Temporal:
  `dayOf` = `workDateInTimeZone`; `nextDayStart` = `ZonedDateTime.add({days:1}).startOfDay()`,
  which handles zones where midnight is skipped.
- **Mobile:** not wired in this card (see 2.8). The copied file stays in sync.

### 2.3 Work timezone source

Time entries use the **entry subject user's `users.timezone`, falling back to UTC**, via
`resolveUserTimeZone` (`packages/db/src/lib/workDate.ts:76-86`). That is what
`persistTimeEntry` uses to stamp `work_date` (`timeEntryWriteCore.ts:366-368`) and what the
drawer already uses (`getTimeEntryUserTimeZone`,
`packages/scheduling/src/actions/timePeriodsActions.ts:373-380`). The split must use the same
function, or the planner and the saved `work_date` could disagree.
`resolveEffectiveTimeZone` (user → tenant → UTC, `workDate.ts:93-115`) is **not** used,
because time entries do not use it. The difference is noted as open question Q3.

- **Server:** `logSession` resolves `resolveUserTimeZone(trx, tenant, entryUserId)`. It does
  this today for sheet resolution (`stopwatchCore.ts:399-401`). It builds the calendar from
  that zone.
- **Client:** `launchTimeEntryForWorkItem` already fetches the zone
  (`packages/scheduling/src/lib/timeEntryLauncher.tsx:194-197`, normalised to `timeZone` at
  line 218). The plan is computed there, not in the tickets package. The tickets package has
  no zone and should not resolve one.

### 2.4 Data flow and contract changes

**Context.** `TimeEntryWorkItemContext` (`packages/types/src/interfaces/scheduling.interfaces.ts:121-144`)
gains `stopwatchSegments?: StopwatchSegmentView[]`. `stopwatchSessionToTimeEntryContext` copies
`session.segments` into it, alongside `stopwatchSessionId`. It keeps `startTime`/`endTime` from
the span so that any other consumer of the context still works.

**Launcher.** When `context.stopwatchSegments` is set, `launchTimeEntryForWorkItem` computes
`toEntryPlan(segments, Date.now(), zonedWorkDayCalendar(timeZone))` and passes the plan to
`NewWorkItemTimeEntry`. `resolveEntryDefaults` (`timeEntryPeriodSelection.ts:154-197`) is applied
per plan item. Its "move to an editable day" fallback is **not** applied to stopwatch items: a
day the user cannot book stays on its real date and shows an inline sheet error (2.6). Moving
real work to another day without saying so would be wrong.

**Save: one atomic call for all entries.** Add a server action
`logStopwatchSession(sessionId, entries: SaveTimeEntryParams[])` in
`packages/scheduling/src/actions/timeEntryCrudActions.ts`. It reuses the permission, mode and
validation preamble of `saveTimeEntry` (lines 340-399), extracted into a shared helper rather
than copied. It calls `logSession` with the list. `saveTimeEntry` with `stopwatch_session_id`
(lines 384-421) becomes a one-element call to the same path, so existing callers keep working.

**Core.** `logSession` (`packages/scheduling/src/lib/stopwatch/stopwatchCore.ts:370-437`) takes
`input.entries?: LogSessionEntryInput[]`, which is today's `LogSessionInput` fields per entry
(`stopwatchTypes.ts:28-46`).

- **Entries given (web drawer):** persist each with `persistTimeEntry`, in order, in the
  caller's transaction. Each entry resolves its own sheet from its own `work_date`. Any failure
  rolls everything back, and the session stays paused, as D4 requires.
- **No entries given (REST/mobile `log`, `stopTimeTracking`):** build the plan server-side with
  the subject user's calendar and persist one entry per item. Explicit `start_time`/`end_time`
  overrides still produce a single entry exactly as today, because the caller chose the span.
- Afterwards the session is marked `logged`. `time_entry_id` = the first entry's id, which keeps
  the wire field (`server/src/lib/api/schemas/stopwatch.ts:54`; mobile reads it,
  `ee/mobile/src/api/stopwatch.ts:24`).
- `LogSessionResult` becomes `{ session, persisted: PersistedTimeEntry[] }`. Every caller
  publishes events for each persisted entry after commit.
- `StopwatchApiService.log` returns `time_entry` (first entry, unchanged) plus `time_entries`
  (all of them). `stopTimeTracking` keeps returning the first entry.

**Session → entries link.** A session can now produce several entries, and a single
`time_entry_id` column can no longer record that. Add the table
`time_tracking_session_entries (tenant, session_id, entry_id)`, PK `(tenant, session_id, entry_id)`,
distributed and colocated with `time_tracking_sessions` the same way the segments table is
(`server/migrations/20261009120000_create_time_tracking_sessions.cjs:59-96`). Every logged entry is
written there. `StopwatchSessionView` gains `time_entry_ids: string[]`. `time_entry_id` stays as
the first entry for compatibility. (Alternative: a nullable `time_entries.stopwatch_session_id`
column. Rejected because it widens the hot `time_entries` table and every time-entry schema for a
fact only the stopwatch reads.)

### 2.5 Day boundary: cap at 23:59

Every existing helper treats 23:59 as the last minute of the day: `getLatestSameDayEndTime`
(`utils.ts:68-72`), `endOfZonedDay` (`timeEntryPeriodSelection.ts:230-233`), and the clamp helpers
(`utils.ts:82-140`) used by the form. An end time of exactly 00:00 has a `work_date` on the next
day. It would fail both `validateTimeEntry` and, at a period boundary, the server's span check
(`timeEntryWriteCore.ts:398-404`). The planner therefore caps each day's `end` at 23:59 local and
reduces `minutes` to match.

Cost: a segment that runs through midnight loses at most 1 minute on the earlier day. The
planner does not carry it forward. The design states this rather than hiding it, and tests
assert it. Changing every time-entry surface to half-open days, so that an entry can end at
24:00, is the correct long-term fix but is out of scope (Q2).

### 2.6 Drawer presentation: every day at once, saved together

**Recommendation: one drawer that lists every planned entry, with one Save that logs the
session atomically.** Sequential editing (save day 1, then reopen for day 2) is rejected. A
session cannot be half-logged: D4 makes saving and closing one transaction, and between two
sequential saves the session would be neither open nor logged. Sequential editing also
breaks if the user cancels after the first save.

- **One plan item:** the drawer renders exactly as today, with one `SingleTimeEntryForm`. A
  session within one day looks and behaves the same as before.
- **N items:** an info `Alert` (the existing notice slot, `TimeEntryDialog.tsx:397-401`) says,
  for example, "This timer ran across 3 days, so it will be saved as 3 time entries, one per
  day." Below it, one `SingleTimeEntryForm` per item, each headed with its date. The forms share
  the session's service and notes as defaults, and each stays editable. Each item has a
  "Remove" action. The user cannot remove the last remaining item; to drop all the time, the
  user discards the timer. The footer shows the total of all items next to Save. The paused
  notice from `timeEntryContext.ts:70-82` stays.
- **State:** `TimeEntryProvider` already keeps `entries[]`, `timeInputs` and `totalDurations` as
  arrays indexed by entry (`TimeEntryProvider.tsx:18,126`). Only the dialog narrows to
  `entries[0]` (`TimeEntryDialog.tsx:321,342,429-433`). `initializeEntries` gains a
  `defaults: Array<{ start, end }>` input. The dialog maps over `entries` and saves all of
  them through `onSave` as an array when a stopwatch session is present.
- **Non-stopwatch callers** (the time sheet grid, existing-entry edits) keep the single-entry
  path. Nothing changes for them.

### 2.7 Inline validation replaces `alert()`

- `validateTimeEntry` becomes pure: `getTimeEntryValidationErrors(entry, workTimeZone)` returns
  `{ startTime?, endTime?, duration? }` as translated messages. It keeps the same rules,
  including **the same-day rule**: once the planner splits at midnight, a cross-day entry can
  only come from the user's own edit, and that edit should be refused. The `alert()` calls at
  `utils.ts:33,42,50` are removed. The function no longer has side effects.
- `TimeEntryEditForm.validateTimes` (`TimeEntryEditForm.tsx:259-300`) duplicates these rules
  with the i18n keys `timeEntryForm.validation.*`. It is reimplemented on the pure function, so
  one rule set serves both.
- The drawer footer's Save calls `TimeEntryDialog.handleSave` → `handleSaveEntry`
  (`TimeEntryDialog.tsx:336-352,180-212`). That path bypasses the form's own `handleSave`, which
  is the only place `showErrors` turns on (`TimeEntryEditForm.tsx:493-498`). This is why the
  user got an alert and a toast instead of field errors. The dialog now runs the pure
  validator for every entry. If any entry fails, it passes `errors` and `showErrors` down to
  that entry's form as props, scrolls to the first invalid form, and does not save. Errors
  appear in the existing red field slots (`TimeEntryEditForm.tsx:865-882,954-956`) under start,
  end and duration. There is no toast for field errors. The toast stays only for server
  rejections (`TimeEntrySaveRejectedError`).
- Sheet problems for a planned day (locked or uncovered) show inline on that entry's date
  field, using the existing `workItemEntry.save.*` copy, and are checked before saving.
- The legacy `server/src/utils/timeEntryUtils.ts:18-30` `validateTimeEntry` logs to the console
  and has no UI. It is left alone.

### 2.8 Order of work

1. `stopwatchMath.ts`: `WorkDayCalendar`, `toEntryPlan`. Copy the file to mobile (parity).
2. `timeEntryPeriodSelection.ts`: `zonedWorkDayCalendar(timeZone)`.
3. Migration: `time_tracking_session_entries`. `stopwatchCore` view: `time_entry_ids`.
4. `stopwatchCore.logSession`: entry list, server-side plan, link rows, array result.
   Update `StopwatchApiService.log`, `TimeEntryService.stopTimeTracking` and the API schema.
5. `timeEntryCrudActions.ts`: extract the save preamble, add `logStopwatchSession`, and route
   `saveTimeEntry` with a session id through it. `timeEntrySaveAdapter.createTimeEntrySaveHandler`
   (`timeEntrySaveAdapter.ts:100-121`) resolves a sheet for each entry.
6. `utils.ts`: pure `getTimeEntryValidationErrors`. `TimeEntryEditForm`: use it and accept
   `errors`/`showErrors` props.
7. Types/context: `stopwatchSegments` on the context, set in `timeEntryContext.ts`.
8. `timeEntryLauncher.tsx` + `NewWorkItemTimeEntry.tsx` + `TimeEntryProvider` + `TimeEntryDialog`:
   plan → multi-entry drawer, single atomic save, inline errors.
9. i18n: new keys under `msp/time-entry` (multi-day notice, remove, total, per-day header) in
   all locales, then regenerate the xx/yy pseudo-locales.

## 3. Rounding and duration semantics

- **Unchanged:** start is truncated to the minute. Minutes are rounded to the nearest minute.
  A session has a 1-minute floor (`stopwatchMath.ts:68-96`). The write core truncates start and
  end to the minute and stores the span duration (`timeEntryWriteCore.ts:409-415`).
- **Per day:** rounding happens per item. The sum of item minutes can differ from
  round(total active) by at most 1 minute per item, from rounding plus the 23:59 cap. Tests
  assert this bound.
- **Contract minimum and round-up** are applied at invoicing, per entry, and are not changed
  here. A multi-day session can therefore bill up to one extra minimum or increment per
  additional day (R1). A session within one day bills exactly as before.
- No tenant-level time-entry rounding or minimum-increment setting exists on the entry path.
  The only rounding settings are the contract-line `minimum_billable_time`/`round_up_to_nearest`
  above.

## 4. Edge cases

| Case | Behaviour |
|---|---|
| Zero-length segment (`end <= start`) | Dropped in normalisation, as `activeMs` does today. |
| Day whose active time rounds to 0 min | Day dropped. If every day drops, one 1-minute entry on the first day (D5 floor). |
| Segment through midnight | Cut at `nextDayStart`. The earlier day ends ≤ 23:59 (loses ≤ 1 min, 2.5). The later day starts 00:00. |
| DST (spring forward, fall back, zones with no midnight) | Boundaries come from Temporal `startOfDay`. Durations are real elapsed ms, so a 23 h or 25 h day books true active time. A displayed wall-clock end can look 1 h off across the jump, which is correct elapsed time. Tests cover both transitions in America/New_York. |
| Pause spanning several days (Joymode: 128 h paused) | Days with no active time produce nothing. Joymode's session becomes one entry for 10/28 (plus 10/29 if the first segment crossed midnight) and one for the second segment's day. |
| Session still running at Stop | `requestStop` pauses before launching (`StopwatchProvider.tsx:188-203`). `logSession` closes any open segment at `now` (`stopwatchCore.ts:385-388`). The planner treats an open segment as ending at `now`, so even the "Stop and log current" conflict path is safe. |
| Timezone changed mid-session | The split uses the subject user's zone **at log time**, the same zone `persistTimeEntry` uses for `work_date`. The zone history is not stored, so a split by a past zone could not be checked against `work_date` anyway. |
| Explicit start/end editing after prefill | Each entry is edited independently. The form recomputes duration from its span, as today. A cross-day edit shows an inline error and blocks Save. Changing an entry's date moves it, and its sheet is resolved from the new date at save. Removing an entry drops its time. |
| Planned day on a locked or uncovered sheet | The entry stays on its real date with an inline sheet error. The user can change that entry's date or remove it. Save is blocked until every entry is valid. |
| Mobile / REST explicit `end_time` override | Unchanged: a single entry over the caller's span, as today. Mobile's `StopTimerModal` (`StopTimerModal.tsx:84,96`) still builds one span (R3). |
| Co-managed shared work (`server/src/lib/co-managed/timeSource.ts:131-140`) | Out of scope. It logs one entry through its own path. |

## 5. Test plan

**Unit: `packages/scheduling/src/lib/stopwatch/__tests__/stopwatchMath.test.ts`**, with a fixed
calendar for America/New_York:
- single segment within one day → 1 item equal to `toEntrySpan`
- multi-segment within one day → 1 item, start = first start, minutes = active, pause not booked
- single segment through midnight → 2 items; first ends ≤ 23:59, second starts 00:00; the sum is within 1 min of the active total
- multi-segment across days with a multi-day pause (the Joymode shape: 7:06 PM start, 2 segments, 12 h 34 m active, 128 h 15 m paused) → one item per active day, no paused time booked
- zero-length segment ignored; sub-30 s day dropped; all-tiny session → single 1-minute item
- open segment closed at `now`
- DST spring-forward and fall-back days
- `ee/mobile/src/features/timer/stopwatchMath.test.ts` parity stays green (file copied)

**Unit: `packages/scheduling/src/lib/__tests__/timeEntryPeriodSelection.test.ts`** (or the existing
test next to it): `zonedWorkDayCalendar` for UTC, New_York, a +13 zone and a zone without midnight.

**Unit: `packages/tickets/src/lib/timeEntryContext.test.ts`:** the context carries
`stopwatchSegments` and the session id. The notice is unchanged.

**Unit: `packages/scheduling/src/components/time-management/time-entry/time-sheet/utils.test.ts`:**
`getTimeEntryValidationErrors` returns field errors for start ≥ end, a cross-day span in the
subject zone, and billable > duration. Spy on `window.alert` and assert it is never called.

**Component: `TimeEntryDialog.stopwatch.test.tsx`** (new, alongside the dialog):
- a one-item plan renders one form with no multi-day notice (single in-day session stays single)
- a three-item plan renders three dated forms, the notice, and the total; Save sends one
  `logStopwatchSession` call with three entries
- **validation UI:** editing an entry to cross midnight and pressing the drawer's Save shows
  the inline end/duration errors on that form, makes no save call and no `alert`, and shows
  no field-error toast
- Remove drops an item. The last item cannot be removed.

**Integration: `server/src/test/integration/stopwatch/stopwatchLog.integration.test.ts`:**
- `logSession` with no entries on a cross-midnight session → N entries, each with the right
  `work_date`, one link row each, `time_entry_id` = first, session `logged`
- with an explicit list of 2 entries → both persisted, each on its own sheet
- a failure on entry 2 (locked sheet) → nothing persisted, session still paused
- a single in-day session → exactly one entry, identical to the pre-change output
- `stopwatchApiService.integration.test.ts`: `log` returns `time_entry` and `time_entries`

**Manual smoke (review step):** in the dev app, start a timer on a ticket, rewrite the
segment rows to the Joymode shape, Stop, see two or more dated entries, Save, and see them
on the time sheet on the right days.

## 6. Deliberately not doing

- One entry per segment (2.1). The planner can produce it if the captain chooses it.
- Half-open days (entries ending at 24:00 / 00:00 next day) across time-entry surfaces (Q2).
- A server-wide same-day rule in `persistTimeEntry`. REST clients and existing rows may rely
  on cross-day entries, so this needs its own decision (Q1).
- The mobile Stop modal's multi-day UI (R3). Mobile gets the server-side split only when it
  sends no explicit span.
- Changing per-entry billing minimum and round-up semantics.
- The co-managed shared-work stop path.

## 7. Risks and open questions for the captain

- **R1 Billing exposure.** A multi-day session now bills one minimum or round-up per day where
  it billed once before. That is consistent with how manually entered daily time bills, but
  it is a change. Accept?
- **R2 Wire shape.** `LogSessionResult.persisted` becomes an array, and REST `log` gains
  `time_entries`. `time_entry` / `time_entry_id` stay as the first entry, so existing clients
  keep working.
- **R3 Mobile.** `StopTimerModal` still prefills one span and sends `end_time`, which makes
  `logSession` write one entry. Mobile can still produce a cross-midnight entry. A follow-up card?
- **Q1** Should the server refuse cross-day entries everywhere, matching the web form?
- **Q2** Do we want half-open days (an entry may end at exactly midnight) as a separate card,
  removing the ≤ 1 min loss at a split?
- **Q3** Time entries use the user zone → UTC, while billing uses user → tenant → UTC. A
  user with no timezone set splits at UTC midnight. Should time entries adopt
  `resolveEffectiveTimeZone`? That would be a cross-cutting change, not part of this card.
- **Q4** Is conversation 1914 (Apex IT Solutions, "Re: ticket timer") the same defect? It has
  not been read yet.
