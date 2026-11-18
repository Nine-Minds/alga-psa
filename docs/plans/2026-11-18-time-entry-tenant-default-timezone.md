# Time entry: fall back to the tenant Default Time Zone

Ticket: alga-2026-0002782 (CloudVBS, Lynda Gaiao). Branch: `feature/time-entry-fall-back-to-tenant-default-time-zone`. Base: `df2e6146`.

## Problem

CloudVBS users in Brisbane (UTC+10, no daylight saving) convert the ticket timer into a time entry and the start and end pickers show UTC. At 08:00 local the form showed 22:00. At 13:42 local it showed about 03:40. The tenant Default Time Zone is set correctly. The user has no profile time zone.

## Root cause

The description is right, but the defect is wider than the drawer. Every time entry path resolves the zone with `resolveUserTimeZone`. That function reads only `users.timezone`, and `normalizeIanaTimeZone` turns a blank value into `UTC`. The tenant Default Time Zone is never consulted. The display path and the write path both use this function, so they agree with each other on UTC. That is why the bug shows up as a clean UTC reading rather than a double shift.

### Display path (ticket timer / work item launcher)

| Hop | Location | What it does |
|---|---|---|
| 1 | `packages/scheduling/src/lib/timeEntryLauncher.tsx:196-199` | `launchTimeEntryForWorkItem` calls `getTimeEntryUserTimeZone()` alongside `fetchTimePeriods`. |
| 2 | `packages/scheduling/src/actions/timePeriodsActions.ts:373-380` | `getTimeEntryUserTimeZone` returns `resolveUserTimeZone(knex, tenant, userId)`. |
| 3 | `packages/db/src/lib/workDate.ts:76-86` | `resolveUserTimeZone` reads `users.timezone` only. |
| 4 | `packages/db/src/lib/workDate.ts:6-14` | `normalizeIanaTimeZone(null)` returns `'UTC'`. |
| 5 | `packages/scheduling/src/lib/timeEntryLauncher.tsx:220-221, 238` | The string becomes `timeZone`, drives `resolveEntryDefaults`, and is passed as `userTimeZone`. |
| 6 | `.../time-sheet/NewWorkItemTimeEntry.tsx:58, 105` | Used for the sheet resolver and passed on as `workTimeZone`. |
| 7 | `.../time-sheet/TimeEntryDialog.tsx:98, 209, 446` | Used for validation and passed to `SingleTimeEntryForm` → `TimeEntryEditForm`. |
| 8 | `.../time-sheet/TimeEntryEditForm.tsx:103-109` | `useSubjectZone` is true because a zone string is always present. Pickers format with `formatZonedTime(value, 'UTC')`. |
| 9 | `.../time-sheet/TimeEntryEditForm.tsx:58-73, 525` | Edited HH:mm values become instants with `instantAtZonedTime(date, time, workTimeZone)`. |

Editing an existing entry takes a different route. `launchExistingEntry` (`timeEntryLauncher.tsx:175`) passes the stored `existingEntry.work_timezone`. For CloudVBS entries created so far, that stored value is `'UTC'`.

### Write path (server derives `work_date` / `work_timezone`)

| Location | Use |
|---|---|
| `packages/scheduling/src/lib/timeEntryWriteCore.ts:366-368` | `saveTimeEntry` core computes `work_date`, `work_timezone`, and `end_work_date` from `resolveUserTimeZone`. |
| `packages/scheduling/src/lib/stopwatch/stopwatchCore.ts:397-398` | The timer → entry conversion picks the time sheet from `work_date` in `resolveUserTimeZone`. |
| `packages/scheduling/src/actions/timeSheetOperations.ts:266-267` | `fetchTimePeriods` materialises "today's" period in `resolveUserTimeZone`. |
| `packages/scheduling/src/actions/timePeriodsActions.ts:346` | `getCurrentTimePeriod` picks "today" in `resolveUserTimeZone`. |
| `packages/scheduling/src/models/timePeriodSettings.ts:269` | Default `effective_from` is "today" in `resolveUserTimeZone`. |
| `packages/scheduling/src/actions/inboundActions.ts:113` | Inbound webhook time entries. |
| `packages/scheduling/src/actions/workTrailActions.ts:63` | Work trail day bucketing. |
| `server/src/lib/api/services/TimeEntryService.ts:357, 494, 684` | REST API create, update, and read. Imports the duplicate in `server/src/lib/utils/workDate.ts:65`. |
| `server/src/lib/co-managed/timeEntryWrite.ts:95` | Co-managed time entry writes. |
| `shared/workflow/runtime/actions/businessOperations/timeDomain.ts:1018, 1323` | Workflow time entry create and update. |
| `ee/packages/microsoft-teams/src/lib/teams/teamsPsaData.ts:466` | Teams time entries. |
| `ee/server/src/lib/actions/extensionScheduleActions.ts:271` | Extension schedules (server duplicate). |
| `packages/tickets/src/actions/optimizedTicketActions.ts:1412` | "Due today" ticket filter. |

Every one of these callers wants the zone the user works in. None of them wants UTC on purpose. UTC is only the result when nothing is configured.

### Why a drawer-only fix would break things

If only `getTimeEntryUserTimeZone` switched to `resolveEffectiveTimeZone`, the form would build an 08:00 Brisbane instant (22:00Z the previous day). `timeEntryWriteCore` would still compute `work_date` in UTC, which gives the previous calendar day. On a period or sheet boundary, the entry would be rejected or filed against the wrong day. The display zone and the `work_date` zone must come from the same resolver.

## Design

### Fallback order

`users.timezone` (if valid IANA) → `tenant_settings.settings.timezone` (if valid IANA) → `UTC`.

### One resolver, one implementation

1. **`packages/db/src/lib/workDate.ts:76-86`**: make `resolveUserTimeZone(knex, tenant, userId)` delegate to `resolveEffectiveTimeZone(knex, tenant, userId)`. Keep the exported name and signature so the 20+ call sites above, and the many test mocks of `resolveUserTimeZone`, stay unchanged. Update the doc comment: "the zone this user works in: profile → tenant default → UTC".
2. **`packages/db/src/lib/workDate.ts:93-114`**: tighten `resolveEffectiveTimeZone` so an *invalid* zone at one level falls through to the next level instead of returning `UTC` early. Today, a garbage `users.timezone` returns `normalizeIanaTimeZone(garbage)` = `UTC` and never reaches the tenant default. Treat each level as "valid IANA or skip" (a small `validZoneOrNull` helper built on `Temporal.TimeZone.from`). Blank and whitespace values count as unset.
3. **`server/src/lib/utils/workDate.ts:65-110`**: delete the duplicate `resolveUserTimeZone` and `resolveEffectiveTimeZone`, and re-export them from `@alga-psa/db`. This removes the `effective-timezone-resolver` LEVERAGE marker from both files. Importers (`TimeEntryService.ts`, `ticketEmailSubscriber.ts`, `extensionScheduleActions.ts`, `timeEntryTestDataFactory.ts`) keep their import paths. The rest of the duplicate module (`normalizeIanaTimeZone`, `computeWorkDateFields`, `truncateToMinute`) can follow the same re-export in this change, since it is the same `workdate-dup` friction. If any of those diverge from the db copy, leave them and keep the marker.
4. **`packages/scheduling/src/actions/timePeriodsActions.ts:373-380`**: no logic change. `getTimeEntryUserTimeZone` inherits the fallback. Update its comment to say it returns the effective zone.

No client component changes are needed for the reported path. `TimeEntryEditForm` already formats and parses in whatever zone it is given.

### When the tenant default is unset

The result is `UTC`, the same as today. There is no server-zone or browser-zone fallback on the server side. A host's zone is not a tenant setting, and using it would make `work_date` depend on which pod handled the request.

### Write path and round trip

- Display: the launcher gets `Australia/Brisbane`. `formatZonedTime(22:00Z, 'Australia/Brisbane')` shows `08:00`.
- Edit: the user types `08:00`. `instantAtZonedTime('2026-10-20', '08:00:00', 'Australia/Brisbane')` gives `2026-10-19T22:00:00Z`. That instant is sent to the server unchanged.
- Persist: `timeEntryWriteCore` stores `start_time = 2026-10-19T22:00Z`, `work_timezone = 'Australia/Brisbane'`, and `work_date = 2026-10-20`, all from the same resolver.
- Render back: `launchExistingEntry` uses the stored `work_timezone` (`Australia/Brisbane`) and shows `08:00` again.

Instants are always UTC on the wire and in the database. Only the wall-clock interpretation changes, so there is no double shift.

### DST and offset edge cases

Brisbane has no DST, but the resolver is shared, so it must be correct for zones that do (for example Australia/Sydney and America/New_York):

- **Display** uses `Intl` or Temporal per instant, so the offset is correct on each side of a transition.
- **Spring-forward gap** (for example 02:30 on the Sydney DST start day does not exist): `instantAtZonedTime` resolves this with Temporal's `compatible` disambiguation, moving the time forward by an hour. Pin this with a test instead of changing it.
- **Fall-back overlap** (01:30 happens twice): `compatible` picks the earlier instant. Add a test for this too.
- **`work_date` near midnight**: computed from the instant in the resolved zone, so 23:30 local stays on the local day. This is the case that breaks if display and write use different resolvers. The round-trip test covers it.
- **Duration across a transition**: durations come from instant differences, not wall-clock differences, so a 01:00–03:00 entry on a fall-back night is 180 minutes. No change. Covered by the existing `clampDurationToZonedSameDay`.

## Open question: "Sydney time"

Lynda's readings are exactly UTC, not Sydney. The likely source of "Sydney": the main time sheet grid opens `TimeEntryDialog` **without** `workTimeZone` (`TimeSheet.tsx:1094`, also `MspActivityCrossFeatureProvider.tsx:118`). It therefore shows times in the **browser's** zone. If her computer or browser is set to Australia/Sydney (UTC+11 in Oct–Nov), the grid would show entries one hour later than Brisbane. Two things would confirm it: her OS zone, and `tenant_settings.settings.timezone` for CloudVBS (in case the tenant default is actually Sydney). Neither can be read from this worktree. The implementation step should query the CloudVBS tenant row and her `users.timezone` read-only before shipping.

## Non-goals

- **No schema migration.** `users.timezone` and `tenant_settings.settings.timezone` already exist.
- **No backfill of existing entries.** Entries already saved for users without a profile zone have `work_timezone = 'UTC'` and a `work_date` taken from the UTC calendar day. When edited, they keep showing UTC, because the launcher honours the stored zone. A UTC zone saved because nothing was configured looks the same as a UTC zone chosen on purpose. Rewriting `work_date` could move entries between sheets, approved periods, or invoices. If the captain wants a backfill, it should be a separate, tenant-scoped, dry-run-first card.
- **No change to the time sheet grid or activity dialog zone handling** (`TimeSheet.tsx:1094`, `MspActivityCrossFeatureProvider.tsx:118`, both browser-local). Bringing these onto the subject zone would change the main time sheet UX for every user whose browser differs from their profile. Recommended as a follow-up card. After this fix, the server-side `work_date` for those surfaces already matches the tenant zone, which helps CloudVBS directly.
- **No change** to other scheduling or calendar zone helpers (`formatZonedTime`, `instantAtZonedTime`, `workDateInTimeZone`, appointment, or business-hours code).
- **No new setting or flag.** The resolver behaviour changes for everyone, and that change is intended.
- Invoice dates (alga-2026-0002771) are tracked separately in `docs/plans/2026-11-11-tenant-local-invoice-date-plan.md`.

## Risks

- **Behaviour change beyond time entry.** Every `resolveUserTimeZone` caller now falls back to the tenant default: Teams entries, workflow entries, the REST API, co-managed writes, inbound webhooks, the "due today" ticket filter, work trail, extension schedules, and the period settings `effective_from`. This is the intended correction. Users with no profile zone in a tenant with a non-UTC default will see "today" and `work_date` move to the tenant's calendar. Call this out in the release note.
- **One extra query.** For users without a profile zone, `resolveEffectiveTimeZone` adds one `tenant_settings` read. That is acceptable. Do not add caching: the tenant default can change at runtime, and existing callers already rely on reading it fresh.
- **Duplicate module consolidation** (step 3) touches server import resolution. The tests and a server build must pass. If re-exporting all of `server/src/lib/utils/workDate.ts` causes a bundling problem, re-export only the two resolvers.
- **Contract tests** that check source strings (`schedulingTenantScoped.contract.test.ts:51-52`) still pass because call sites are unchanged.

## Documentation

`~/nm-store/packages/nm-store/src/site/content/docs/general-settings.md:17` currently says the Default Time Zone "is used for emails and notifications when a user has not set their own timezone". Change it to say the zone is also used for time entry times and dates, time sheet "today", and due-date filters when a user has not set a profile time zone, and that a user's own profile time zone always takes priority. The doc lives in the nm-store repo, so it is a separate commit or PR there.

## Tests

**Unit: resolver** (`packages/db/src/lib/workDate.test.ts`, stubbed knex like the existing `resolveTenantToday` block):

1. User zone `America/New_York`, tenant `Australia/Brisbane` → `America/New_York`.
2. User zone blank (`null`, `''`, whitespace), tenant `Australia/Brisbane` → `Australia/Brisbane`.
3. User zone blank, tenant unset → `UTC`.
4. User zone invalid (`'Not/AZone'`), tenant `Australia/Brisbane` → `Australia/Brisbane` (falls through, see design step 2).
5. Tenant zone invalid, user blank → `UTC`.
6. `resolveUserTimeZone` and `resolveEffectiveTimeZone` return the same value for all of the above.

**Integration: drawer action** (`packages/scheduling/tests/timePeriodsActions.*`, DB-backed per the integration-testing skill):

7. `getTimeEntryUserTimeZone()` for a user with no profile zone in a tenant set to `Australia/Brisbane` returns `Australia/Brisbane`. Repeat for cases 1 and 3.

**Round trip** (`packages/scheduling` DB test through `timeEntryWriteCore` / stopwatch conversion):

8. Brisbane tenant, user with no profile zone: stopwatch session 2026-10-19T22:00Z–23:00Z converted to an entry. Expect `start_time = 2026-10-19T22:00Z`, `work_timezone = 'Australia/Brisbane'`, `work_date = 2026-10-20`, and filing on the sheet whose period contains 2026-10-20. Then `formatZonedTime(start_time, work_timezone)` returns `'08:00'`.
9. Same tenant, user with a profile zone of `America/New_York`: `work_timezone = 'America/New_York'`, and `work_date` follows the New York calendar.
10. No zones anywhere: `work_timezone = 'UTC'` (regression guard).

**DST pinning** (`packages/scheduling` unit test on `instantAtZonedTime`):

11. `Australia/Sydney` 2026-10-04 02:30 (gap) resolves forward to 03:30 AEDT.
12. `America/New_York` 2026-11-01 01:30 (overlap) resolves to the earlier offset (EDT).

**Component** (`packages/scheduling/tests/timeEntryLauncher.test.tsx`):

13. With `getTimeEntryUserTimeZone` mocked to `Australia/Brisbane` and `now = 22:00Z`, the drawer's start picker shows `08:00`.
