# Time period dialog: end date off-by-one (#3206 item 3)

Card: 7d557aa6 · Issue: Nine-Minds/alga-psa#3206 (item 3) · Base: `main` @ `b0d0b4dacf`
Sibling card: #3206 items 1–2 (first-period suggester), which also edits
`packages/scheduling/src/lib/timePeriodSuggester.ts`.

## Problem

Time periods are stored as half-open intervals `[start_date, end_date)`. The
database, `TimePeriod.findOverlapping`, `suggestNewTimePeriod`, the bulk
generator, and the REST API all use that convention.

The Create/Edit Time Period dialog (`TimePeriodForm.tsx`) never converts between
the stored value and what the user sees:

| Path | Current behaviour | Result |
|---|---|---|
| Create, user picks end 8/22 | saves `end_date = 2026-08-22` unchanged | list shows 8/16 – **8/21** |
| Create, suggester prefill | shows the stored (exclusive) end raw | picker shows the day *after* the period |
| Edit, load | loads stored exclusive end into picker | picker and list disagree by one day |
| Start date changed (non-override) | `calculateEndDate`: day/month/year return the last included day, week returns the exclusive end | mixed conventions, then saved raw |
| Client overlap check | compares the raw picker value as exclusive | right by accident for create, wrong once the picker is inclusive |
| Client `start < end` check | `start >= end` rejects | a one-day period (start = last day) is rejected once the picker is inclusive |

Both list components already display `end_date − 1 day`
(`settings/time-entry/TimePeriodList.tsx:24`,
`time-management/time-entry/TimePeriodList.tsx:16`), and the settings help text says
"End Day is the last day included in the period". The list is correct and the dialog is wrong.

A period becomes immutable once a timesheet attaches, so users can't fix a wrong
period later. The fix has to be in the dialog itself.

## Decisions

1. **Storage and API stay half-open. No data migration.** Stored `end_date` is
   exclusive everywhere server-side. The conversion happens only at the UI
   boundary.
2. **The dialog's end-date picker shows and accepts the last included day.**
   - save: `stored_end = picked + 1 day`
   - edit load / suggester prefill: `picked = stored_end − 1 day`
3. **`TimePeriodSuggester.calculateEndDate` returns the exclusive end for every
   frequency unit.** This matches `suggestNewTimePeriod`, `getEndOfPeriod`, and storage,
   so all of the suggester's output uses one convention. The dialog
   converts it like any other stored-convention value. The method's JSDoc states
   the convention.
4. **One shared helper module owns the conversion.** It's a new pure module,
   `packages/scheduling/src/lib/timePeriodDisplay.ts`, with no React and no I/O:
   - `exclusiveEndToLastIncludedDay(end: PlainDate | string): PlainDate`
   - `lastIncludedDayToExclusiveEnd(day: PlainDate): PlainDate`
   - `formatPeriodLastDay(end: string): string`. The two lists use this in place
     of their duplicated local `getLastInclusiveDay`. The time-management copy slices
     `.slice(0, 10)` to handle timestamp strings, and the shared helper keeps that.

   The dialog's validation and payload logic moves into pure functions in the same
   module so it can be unit-tested without rendering the dialog:
   - `toDialogDates(period: {start_date, end_date}): {startDate, lastDay}` (edit
     load and suggester prefill)
   - `toStoredPeriod({startDate, lastDay}): {start_date, end_date}` (save payload)
   - `validateDialogPeriod({startDate, lastDay}, existing, excludeId?)`. This returns
     `null | 'startDateRequired' | 'startAfterEnd' | 'overlap'`. Overlap is computed on
     the stored (exclusive) values.
5. **Validation rule change:** the period is valid when `startDate <= lastDay`, so a
   one-day period is allowed. The message key
   `timeEntry.periods.errors.startBeforeEnd` is reworded to "End date cannot be
   before the start date." The key name doesn't change, and every locale gets the
   new text.
6. **Copy:** the dialog label becomes "Last Day of Period". A help line under the
   end picker reads "The period includes this day." and matches the settings page
   wording ("End Day is the last day included in the period"). The list column
   header `timeEntry.periods.columns.endDate` becomes "Last Day" in English so the
   list and dialog agree. All 11 locale files get the new/changed keys. English is
   authoritative. de/es/fr/it/nl/pl/pt/sv get translations, and xx/yy are regenerated
   with the pseudo-locale script.
7. **API:** semantics stay as they are (exclusive). The convention gets documented in
   the zod schemas (`.describe()` on `end_date` in `createTimePeriodSchema`,
   `timePeriodResponseSchema`, and the `time_period` sub-object of the timesheet
   response) and in the OpenAPI route descriptions for `POST/PUT /api/v1/time-periods`.
   Example text: "Exclusive end of the period: the first day *after* the period.
   A period covering Aug 16–22 has end_date 2026-08-23."

## Rejected alternatives

- **Store inclusive end dates and migrate the data.** This would touch every reader
  (overlap SQL, `findByDate`, timesheet attach, billing/approval queries, API
  consumers), and the immutability rule makes migration risky. The half-open
  storage is correct. Only the UI boundary is wrong.
- **Make `calculateEndDate` return the inclusive day.** It would save one conversion
  in the dialog, but `calculateEndDate` would then disagree with
  `suggestNewTimePeriod` in the same class. One convention per layer is the point.

## `calculateEndDate` spec (exclusive end)

Let `f = settings.frequency` (≥ 1). Let `start` = the chosen start date.

| unit | exclusive end |
|---|---|
| day | `start + f days` |
| week | `start + f weeks` |
| month, `end_day` unset | `start + f months` |
| month, `end_day = 0` (end of month) | first day of the month after `start + (f−1) months` |
| month, `end_day = d` | `last = (start + (f−1) months).with(day: min(d, daysInMonth))`. If `last < start` (e.g. start 16th, end_day 15), use `last = (start + f months).with(day: min(d, daysInMonth))`. Return `last + 1 day`. |
| year | `start + f years` |

Today's behaviour for `month` with `end_day`
(`start + f months − 1 day` then `.with({day})`) sets the day on the wrong
month for mid-month starts. The new spec fixes that as part of unifying the convention.

The dialog uses `settings[0]` today, and that doesn't change here. Picking the setting
that applies to the chosen start date is the sibling card's domain (items 1–2).
This card only touches `calculateEndDate`.

## Files to change

| File | Change |
|---|---|
| `packages/scheduling/src/lib/timePeriodDisplay.ts` (new) | conversion, payload, and validation helpers (Decision 4) |
| `packages/scheduling/src/lib/timePeriodSuggester.ts` | `calculateEndDate` → exclusive per spec, plus JSDoc on the class/method stating the `[start, end)` convention |
| `packages/scheduling/src/components/settings/time-entry/TimePeriodForm.tsx` | state holds `lastDay` (inclusive). `INITIALIZE_EDIT_MODE` / `INITIALIZE_CREATE_MODE` go through `toDialogDates`. `handleStartDateChange` converts the `calculateEndDate` result. `handleSubmit` uses `validateDialogPeriod` + `toStoredPeriod`. New label and help text. |
| `packages/scheduling/src/components/settings/time-entry/TimePeriodList.tsx` | use shared `formatPeriodLastDay`, remove local helper |
| `packages/scheduling/src/components/time-management/time-entry/TimePeriodList.tsx` | same |
| `server/public/locales/{en,de,es,fr,it,nl,pl,pt,sv,xx,yy}/msp/settings.json` | `timeEntry.periods.form.endDate` → "Last Day of Period". New `timeEntry.periods.form.endDateHelp`. Reword `errors.startBeforeEnd`. `periods.columns.endDate` → "Last Day". |
| `server/src/lib/api/schemas/timeSheet.ts` | `.describe()` exclusive-end docs on time-period `end_date` fields |
| `server/src/lib/api/openapi/routes/workManagementV1.ts` | time-period create/update/get descriptions mention the exclusive `end_date` |
| `packages/scheduling/tests/timePeriodDisplay.test.ts` (new) | see Tests |
| `packages/scheduling/tests/timePeriodSuggester.test.ts` | `calculateEndDate` per unit |

`server/src/lib/timePeriodSuggester.ts` is a stale duplicate. Only
`server/src/test/unit/timePeriodSuggester.test.ts` imports it, and no production code
does. It is out of scope here. Leave a `// LEVERAGE: pattern period-end-calc` marker
(see below) and don't edit it, so the sibling card doesn't get a conflict.

## Tests (vitest, `packages/scheduling`)

`timePeriodDisplay.test.ts`:
- create: picking last day 2026-08-22 with start 2026-08-16 produces the payload
  `{start_date: '2026-08-16', end_date: '2026-08-23'}`. This is the exact issue repro.
- edit round-trip: stored `[2026-08-16, 2026-08-23)` → dialog `lastDay 2026-08-22`
  → saved unchanged → same stored value. Also covered across a month boundary and
  Feb 29 in a leap year.
- suggester prefill: a weekly suggestion `[2026-01-01, 2026-01-08)` displays lastDay
  `2026-01-07`.
- validation: start == lastDay passes (one-day period). lastDay < start →
  `startAfterEnd`. A period touching an existing one (new start == existing exclusive
  end) passes. Last day == existing start → `overlap`. The edit-mode self-exclusion
  works.
- `formatPeriodLastDay` accepts both `YYYY-MM-DD` and full ISO timestamps.

`timePeriodSuggester.test.ts`, `calculateEndDate`:
- day f=1 and f=7
- week f=1 and f=2
- month: no end_day, end_day=0, end_day=15 from the 1st, end_day=15 from the 16th
  (rolls to the next month), end_day=31 in a 30-day month
- year
- every unit's result equals `suggestNewTimePeriod`'s end for the same start/setting
  where both apply (a consistency guard)

Manual smoke test (dev server :3729): Settings → Time Entry → Time Periods → Create.
With override on, pick 8/16 → 8/22, create, and check the list shows 8/16 – 8/22.
Edit it and check the picker shows 8/22. In the API (`GET /api/v1/time-periods/{id}`),
check `end_date` is 2026-08-23.

## Out of scope / flagged for follow-up

- **Bulk generator `end_day` off-by-one.** `getEndOfPeriod` in
  `timePeriodsActions.ts:370` returns `.with({ day: end_day })` as the *exclusive*
  end, so "End Day 15" generates periods covering the 1st–14th. That contradicts the
  settings help text. `generateAndSaveTimePeriods` has no UI caller today (only
  integration tests), so the bug is latent. Recommend a separate card.
- **"No End Date" checkbox.** Submit dereferences `endDate!`, so an open-ended
  period throws client-side, and the server requires an end date anyway. This card
  keeps the existing behaviour. Recommend removing the checkbox in a follow-up, since
  open-ended periods aren't supported by storage or overlap logic.
- **Three implementations of the period end** (`suggestNewTimePeriod` switch,
  `calculateEndDate`, `getEndOfPeriod`, plus the stale server copy). Mark each with
  `// LEVERAGE: pattern period-end-calc — one setting→[start,end) engine should own this`.
  Don't consolidate on this card, because the sibling card is mid-edit in the
  suggester.

## Coordination with sibling card (#3206 items 1–2)

Both cards edit `timePeriodSuggester.ts`. This card only touches `calculateEndDate`
and adds doc comments. It doesn't touch `suggestNewTimePeriod`. Whichever card merges
second rebases, and conflicts should stay limited to the class-level JSDoc. If the
sibling changes how `suggestNewTimePeriod` picks a setting, the consistency test above
catches any convention drift.
