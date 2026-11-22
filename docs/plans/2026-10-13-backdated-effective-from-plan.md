# Backdated effective_from default vs. a setting that ended mid-period

Follow-up to #3206. Card 010bb99f. PSA ticket alga-2026-0002701.

## Problem

`createTimePeriodSettings` (packages/scheduling/src/actions/time-period-settings-actions/timePeriodSettingsActions.ts:168) defaults a missing `effective_from` to `defaultEffectiveFrom(setting, localToday)` (packages/scheduling/src/lib/timePeriodSuggester.ts:110). That is the start of the period containing the user's local today. If an earlier active setting has an `effective_to` on or after that aligned start, `validateTimePeriodSettings` (timePeriodSettingsActions.ts:356) matches Case 1 (`effective_from < new.effective_from AND effective_to > new.effective_from`, lines 403-412) and Case 3 (lines 426-433). The save is then rejected with "The specified time period overlaps with existing time periods".

Example: a weekly Sunday setting ended Tue 2026-10-06. A new weekly Sunday setting is saved Sat 2026-10-10 with no date. The default 2026-10-04 is rejected. Infra test 23 (server/src/test/infrastructure/time-periods/timePeriods.test.ts:556) pins this.

### How the state can arise

- **Server action (settings UI).** This is the only caller that takes the default path. `TimePeriodSettings.tsx:141` never sends `effective_from`.
- **REST.** Before this follow-up there was no REST endpoint for time period settings. `ApiTimeSheetController` had settings handlers, but no route mounted them and their schema did not match the table. The follow-up adds `/api/v1/time-period-settings` (see "REST endpoint" below), which goes through the same model as the action.
- **The action's update.** The `updateTimePeriodSettings` action can set `effective_to` on an existing active setting, and so can `PUT /api/v1/time-period-settings/{id}`. That is how the "old setting ended mid-period" state appears. Direct data writes can also create it.

The trigger is: an active setting is ended with `effective_to` through an update, REST or data, and then a new setting is added from the UI. The trigger gets more likely if a visible Effective From/To field is added later (the backfill follow-up on #3206).

## Decision

When the caller omits `effective_from`, use the first day no conflicting setting governs, but never earlier than the aligned period start:

```
default = max(alignedStart, dayAfter(latest effective_to among conflicting ended settings))
```

A setting is a **conflicting ended setting** if all of these hold:
- `is_active = true`, which matches the validator's filter.
- `effective_to IS NOT NULL` and `effective_to >= alignedStart`. Compare date parts.
- `doPeriodsOverlap(new, existing)` is true (timePeriodSettingsActions.ts:297). This keeps semi-monthly pairs safe. Two monthly settings with disjoint day ranges (1-15 and 16-end) legitimately coexist and must not push each other's start.

Key choices:

1. **Use the day after, not the day of.** `isSettingEffectiveOn` (timePeriodSuggester.ts:49) treats `effective_to` as inclusive. The validator treats it as exclusive (`effective_to > from`). Starting the day after the old setting's `effective_to` satisfies both: no day is governed by two settings, and validation passes. Starting on the same day would pass validation, but the suggester would see two settings in force on that day.
2. **Do not cap the default at today.** If the conflicting setting ends today or later, the default moves to the day after it ends, even if that day is in the future. The rule stays one coherent definition ("earliest free day ≥ current period start"). The old setting still governs today, so the current period still materializes from it. Open-ended settings (`effective_to IS NULL`) and settings that start after the clamped date are **not** clamped around. Validation still rejects them as before, because they are real conflicts that only the user can resolve.
3. **Explicit `effective_from` is never adjusted.** The clamp runs only on the default branch (timePeriodSettingsActions.ts:179-199). An explicit overlapping date is still rejected.
4. **Run the clamp inside the insert transaction.** The conflict read and the validation read must see the same rows. Time zone resolution and the aligned start stay outside the transaction, where they are today.

## Changes

Order: 1 → 2 → 3 → 4. Steps 1 and 2 are independent of the database; step 3 depends on both.

### 1. Pure helper — packages/scheduling/src/lib/timePeriodSuggester.ts

Add a helper next to `defaultEffectiveFrom` (after line 113):

```ts
/**
 * Clamp a defaulted effective_from past earlier settings that end on or after it: the new
 * setting starts the day after the latest such effective_to (effective_to is inclusive).
 */
export function clampDefaultPastEndedSettings(
  aligned: Temporal.PlainDate,
  endedSettings: Pick<ITimePeriodSettings, 'effective_to'>[]
): Temporal.PlainDate
```

The helper returns `max(aligned, max(parse(effective_to)) + 1 day)` over settings with a non-null `effective_to` that is on or after `aligned`. Otherwise it returns `aligned` unchanged. It knows nothing about overlap semantics. The caller filters by `doPeriodsOverlap`. Use the existing `parseDateValue` so that `Date`/ISO-timestamp `effective_to` values (the column is `timestamp` since migration 20241019194900) reduce to date parts.

### 2. Unit tests — packages/scheduling/tests/timePeriodSuggester.test.ts

Add these cases to the `defaultEffectiveFrom (#3206)` describe (line 232) or to a sibling describe:
- No ended settings → aligned unchanged.
- Ended before aligned (`effective_to` 10-03, aligned 10-04) → 10-04.
- Ended on aligned (`effective_to` 10-04) → 10-05.
- Ended mid-period (10-06) → 10-07.
- Several ended settings (10-05, 10-08) → 10-09, the latest one wins.
- Ended in the future (10-12, today 10-10) → 10-13.
- Timestamp input `'2026-10-06T00:00:00.000Z'` → 10-07.

### 3. Action — timePeriodSettingsActions.ts `createTimePeriodSettings` (lines 168-249)

- Keep the time zone and `localToday` block (lines 179-197). Compute `aligned = defaultEffectiveFrom(...)` and record `defaulted = !settings.effective_from`.
- Move the construction of `newSettings` (lines 201-216) inside `withTransaction` (line 218). Alternatively, build it with `aligned` and patch `effective_from` inside the transaction before `validateTimePeriodSettings` (line 220).
- When `defaulted` is true, before validating, read active settings with non-null `effective_to >= aligned` through `tenantScopedTable(trx, 'time_period_settings', tenant)`. Keep only those where `doPeriodsOverlap(newSettings, row)`. Set `newSettings.effective_from = clampDefaultPastEndedSettings(aligned, rows).toString()`.
- Then validate and insert as today. Validation remains the only rejection path.
- Update the comment at lines 181-182 to describe the hand-off.

Mark the semantic split with a `// LEVERAGE: friction effective-to-inclusivity` comment at the validator's `effective_to > effectiveFrom` (around line 410). Add the same marker next to `isSettingEffectiveOn`. The validator treats `effective_to` as exclusive and the suggester treats it as inclusive. This plan works within both conventions and does not unify them.

### 4. Infra tests — server/src/test/infrastructure/time-periods/timePeriods.test.ts

Rewrite test 23 and add tests 24-27 in the `effective_from default (createTimePeriodSettings)` describe (line 497). All of them freeze Sat 2026-10-10 15:00Z with the user in UTC unless stated otherwise.

- **23. Mid-week hand-off.** Existing weekly Sunday setting from 09-01, ended 10-06 (as now). Create with no date → `effective_from` is 10-07. Then run `ensureTimePeriodCoversDate(10-10)`. With no stored periods, expect `[['2026-10-07','2026-10-11']]`, a short bridging period that rejoins the Sunday grid. Then run `createNextTimePeriod([...], 7, { today })` and expect the next period `['2026-10-11','2026-10-18']`. Keep the existing assertion that an explicit `effective_from: '2026-10-10'` is honored unchanged. Rename the test to describe the new behavior.
- **24. Hand-off with periods already stored.** The same old setting, plus stored periods `[09-27,10-04)` and `[10-04,10-11)` that the old setting materialized. Create with no date → 10-07. `ensureTimePeriodCoversDate(10-10)` is a no-op (stored periods unchanged). The next period is `[10-11,10-18)`. No day is covered twice and no day is left uncovered.
- **25. Hand-off on the start day.** (a) Old setting ended Sat 10-03 → the default stays 10-04, the clamp is a no-op, and the current period is `[10-04,10-11)`. (b) Old setting ended Sun 10-04 → default 10-05. The period from `ensureTimePeriodCoversDate`: with no stored periods, the bootstrap gives `[10-05,10-11)`.
- **26. Monthly.** Today 2026-10-13. Old monthly setting (`start_day` 1, `end_day` 0) ended 10-05. Create monthly with no date → 10-06. The current period is `[10-06,11-01)` and the next one is `[11-01,12-01)`. Also check that a semi-monthly partner which `doPeriodsOverlap` treats as disjoint (`start_day` 16, `end_day` 0, ended 10-20) does **not** clamp a new 1-15 setting. Its default stays 10-01, or the save is rejected for an unrelated reason. Confirm the actual `doPeriodsOverlap` result while writing the test and assert whatever is true.
- **27. Explicit overlapping `effective_from` is still rejected.** The same old setting ended 10-06. `createTimePeriodSettings({ ...weeklyInput, effective_from: '2026-10-04' })` returns an `actionError` matching `/overlaps/i`, and no row is inserted.
- **28. Open-ended conflict is still rejected.** An active weekly setting with no `effective_to` exists. A create with no date is rejected as before (no clamp).

Run with `npx vitest run server/src/test/infrastructure/time-periods/timePeriods.test.ts` against the wired stack (alga-psa-local-test), then run `npx vitest run packages/scheduling/tests/timePeriodSuggester.test.ts`.

## How the hand-off resolves into periods

These are the results the tests assert. They follow from the existing suggester; the suggester needs no change.
- **No stored periods.** The bootstrap picks the setting whose cell contains today. That is the new setting, starting at its off-grid `effective_from`, so the first period is the bridge `[10-07,10-11)`.
- **Stored periods up to the current week.** `ensureTimePeriodCoversDate` finds a period covering today and does nothing. Fill-forward continues from the latest `end_date`. The old setting is no longer in force at 10-11, so the new setting's cell takes over.
- **Stored periods end before the current week (e.g. last end 10-04).** The suggester targets 10-04. The new setting is not in force there, but the old one is. `periodContaining` does **not** clip a cell at `effective_to`, so it yields the old setting's whole cell `[10-04,10-11)`. Coverage is still contiguous and single, but the old setting's grid governs the hand-off week instead of a bridge. This is existing behavior. See Out of scope.

## REST endpoint

The rules live in one place: the scheduling `TimePeriodSettings` model (`packages/scheduling/src/models/timePeriodSettings.ts`). It holds `create`, `update`, `delete`, `getById` and `list`. Create owns the user-timezone default, the hand-off clamp and overlap validation. Update validates the merged row and never moves dates. Both the settings server actions and `TimeSheetService` call it. Rule failures throw `TimePeriodSettingsRuleError` with a `kind`. The action returns the message, and REST maps `invalid`, `not_found` and `overlap` to 400, 404 and 409.

`/api/v1/time-period-settings` (GET, POST) and `/{id}` (GET, PUT, DELETE) are gated on `time_period` read/manage. They are PSA-only in `productSurfaceRegistry` and registered in OpenAPI with real body and response schemas. Effective dates are `YYYY-MM-DD`. POST without `effective_from` gets the same default and hand-off as the UI, using the API key user's timezone. An explicit overlapping date returns 409 and writes nothing. PUT accepts `effective_to: null` to clear the end date.

Two rules are new for both callers. `effective_to` before `effective_from` is rejected (400). Deactivating a setting (`is_active: false`) skips the overlap check, because inactive settings take no part in period generation.

Infra tests: `server/src/test/infrastructure/time-periods/timePeriodSettingsApi.test.ts`.

## Out of scope

- Clipping suggester cells at `effective_to`, so the old setting's cell ends at its `effective_to` and the new setting bridges.
- Unifying the inclusive and exclusive semantics of `effective_to` between `isSettingEffectiveOn` and `validateTimePeriodSettings`. A marker is left at both sites.
- Showing Effective From/To in the settings form (the backfill follow-up).
- `doPeriodsOverlap` treats week/day settings as always overlapping and computes `getEndOfPeriodDay` from the current month.

## Risks

- **A future default.** If the conflicting setting ends after today, the new setting starts in the future and the UI shows no change for today. This is acceptable because the old setting still governs today. The rule is documented in the helper JSDoc.
- **Filter mismatch.** If the clamp's conflict filter differs from the validator's filter, the clamp can fix one conflict while the validator still rejects for another. That is the intended outcome. The tests cover open-ended and explicit conflicts so the remaining rejections are deliberate.
- **Timestamp column.** `effective_to` is a `timestamp`. Reduce it to date parts before adding a day. A Date at UTC midnight parsed in a non-UTC server time zone could shift by one day, so use `formatUtcDateNoTime` or `parseDateValue` on the ISO string, never local `getDate()`.
