# Time Entry “Work Date” Plan (Option A)
**Date:** December 14, 2025  
**Status:** Proposed  
**Owner:** Time Tracking / Billing  

## Decisions (Confirmed)
- `work_date` is **not user-editable**.
- `work_date` is computed in the **user’s timezone** (i.e., “the user’s calendar date”).
- We will store the timezone used for computation on each entry as `work_timezone` (for audit/debug).

## Problem
Today, time entry → time sheet → time period mapping is effectively **instant-based** (`start_time`/`end_time` as timestamps) while time periods and the timesheet UX are **calendar-based** (“Apr 1–Apr 7”, “week of Apr 1”, etc.). Because instants are stored/compared in UTC-ish representations, users in non-UTC timezones can end up entering “Apr 1” locally while the system evaluates the entry against a different calendar day, creating confusing edge cases when determining the correct `period_id`/timesheet.

We want to **keep** the current architecture (persisted `time_periods`, `time_sheets` keyed by `period_id`, approvals, period CRUD, background period generation) while removing the conceptual mismatch between user-local calendar days and UTC instants.

## Proposed Solution (Option A)
Introduce an explicit **date-based bucketing field** on time entries:

- Add `work_date` to `time_entries` as a *date (no time)*.
- Define `work_date` as “the calendar date the work is attributed to” in the **user’s timezone**.
- Determine the time period / timesheet association using `work_date` vs `time_periods.start_date/end_date` (date-to-date comparisons), not using UTC instants.

We will still store `start_time` and `end_time` as instants for duration, auditability, ordering, and billing calculations, but **grouping and period membership** will use `work_date`.

## Timezone Source of Truth
We need a stable source of truth for the user’s timezone at entry creation time.

Recommended resolution order:
1. `users.timezone` (preferred, already exists in schema)
2. Tenant default timezone (if we have one)
3. `'UTC'` (last resort)

Note: even if we fall back to a non-user timezone, we still persist `work_timezone` so we can detect and remediate missing user timezone configuration.

## Goals
- Preserve existing persisted `time_periods` behavior (listing, manual overrides, scheduled creation job).
- Make timesheet bucketing consistent with “calendar day” as the UI expresses it.
- Minimize schema/code churn and keep backwards compatibility.
- Avoid retroactively changing historical timesheet membership when settings/timezones change.

## Non-Goals
- Eliminating `time_periods` records.
- Reworking the billing cycle subsystem.
- Changing approval semantics.

## Data Model Changes
### 1) `time_entries`
Add:
- `work_date DATE NOT NULL`
- `work_timezone TEXT NOT NULL`
  - Stores the timezone used to compute `work_date` at create/update time (e.g., `America/Los_Angeles`).

Indexes (initial recommendation):
- `(tenant, user_id, work_date)`
- `(tenant, work_date)`

### 2) (Optional) `time_sheets` snapshot fields
Not strictly required for Option A, but consider adding:
- `period_start_date DATE`
- `period_end_date DATE`

This reduces join dependency for display and provides a historical snapshot even if periods are edited.
If we keep period edit capability, we must decide whether edits should:
- update existing timesheets’ displayed boundaries, or
- be blocked once timesheets exist (current behavior blocks editing if sheets exist in `server/src/lib/actions/timePeriodsActions.ts`).

## Behavior Changes
### A) Saving a time entry
When creating/updating a time entry:
- Compute `work_date` from `start_time` using the resolved **user timezone**.
- Persist `work_date` and `work_timezone`.
- Ignore any incoming `work_date`/`work_timezone` fields from clients (not user-editable).

### B) Choosing a timesheet / period for an entry
When an entry is created outside a timesheet context (API, quick-add):
- Find the `time_periods` row where:
  - `start_date <= work_date` and `end_date > work_date` (treat periods as half-open `[start,end)` dates)
- Then `fetchOrCreateTimeSheet(user_id, period_id)` and attach `time_sheet_id`.

When an entry is created from a specific timesheet UI:
- Continue attaching directly to that `time_sheet_id`/`period_id`.
- Still compute/persist `work_date` for consistency and reporting.

### C) Validation rule
Replace “time entry must fall within a valid time period” checks that currently compare instants with checks that compare `work_date` with period date boundaries.

## Migration / Backfill Plan
Existing rows in `time_entries` need a backfilled `work_date`.

Constraints:
- Historical user timezone at time of entry may not be available.

Backfill strategy options:
1. **User timezone backfill (preferred):** compute using `users.timezone` when present.
2. **Fallback backfill:** if a user has no timezone, fall back to tenant default (if any) else `'UTC'`.

Backfill must also populate `work_timezone` with whatever timezone was used per row so we can identify entries computed with fallback logic.

## Implementation Surface (What Changes Where)
### Project-Specific Gotchas / Clarifications
- **Time periods are date-based:** migrate `time_periods.start_date/end_date` to `DATE` (timezone-agnostic), keeping half-open `[start,end)` semantics. This eliminates server-timezone and cast-related ambiguity and makes period membership comparisons explicitly date-to-date.
- **Resolving `users.timezone` server-side:** server actions that compute `work_date` (and “current period”) need a reliable way to fetch the current user and then read `users.timezone`.
  - For interactive flows: resolve timezone from the authenticated user record.
  - For non-interactive/system contexts (background jobs, service accounts): define an explicit fallback rule (tenant default or `'UTC'`) and persist that choice to `work_timezone`.
- **Enterprise/Citus impact:** EE has Citus distribution migrations that reference time/billing tables. Adding columns/indexes to `time_entries` should be verified against EE distributed table behavior (and include any EE-specific migration steps if required).
- **Validation/test ripple:** adding `work_date/work_timezone` will require updates across:
  - TypeScript interfaces (`server/src/interfaces/timeEntry.interfaces.ts`)
  - Zod schemas used by UI/server actions (`server/src/lib/schemas/timeSheet.schemas.ts`) and API schemas (`server/src/lib/api/schemas/timeEntry.ts`)
  - Test factories and fixtures that insert `time_entries` rows
- **“Today” in UI:** existing code uses UTC-derived strings (e.g. `new Date().toISOString().slice(0, 10)`) for “today/current period” checks. These must be replaced with browser-local date logic anywhere they influence “current” labeling or default date selection.

### Screens (UI)
- `server/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx`
  - Ensure create/update calls do not send `work_date`; server computes it.
  - Validate the date/time pickers produce correct instants for `start_time`/`end_time` (avoid date-only parsing pitfalls).
- `server/src/components/time-management/time-entry/time-sheet/TimeSheetTable.tsx`
  - Any “quick add” path that constructs timestamps from a displayed date should construct instants in the user’s timezone (not via `toISOString().slice(0,10)` patterns).
- `server/src/components/time-management/time-entry/TimePeriodList.tsx`
  - The “Current” period highlight should use the user’s local date (not UTC derived from `toISOString()`).
- “Create time entry from elsewhere” entry points that call `saveTimeEntry`:
  - `server/src/components/time-management/interval-tracking/IntervalManagement.tsx`
  - `server/src/components/tickets/ticket/TicketDetails.tsx`
  - `server/src/components/projects/TaskForm.tsx`
  - `server/src/components/interactions/InteractionDetails.tsx`
  - `server/src/components/tickets/TicketingDashboard.tsx`
  - `server/src/components/user-activities/ActivityDetailViewerDrawer.tsx`
  - Confirm these flows still land in the expected timesheet/period after `work_date` becomes authoritative.

### Server Actions (Next.js “use server”)
- `server/src/lib/actions/timeEntryCrudActions.ts`
  - Compute and persist `work_date`/`work_timezone` on create/update.
  - Ignore any client-supplied values for these fields.
- `server/src/lib/actions/timePeriodsActions.ts`
  - Update `getCurrentTimePeriod()` to compute “today” in the **user’s timezone** (not server timezone).
- `server/src/lib/actions/timeSheetOperations.ts`
  - Ensure any “current period” or “entry belongs to period” logic is date-based where applicable.

### API Services (REST-ish)
- `server/src/lib/api/services/TimeEntryService.ts`
  - When creating entries (and when auto-creating timesheets), use `work_date` (computed via user timezone) to find the correct period and timesheet.
  - Update `getTimePeriodForDate`/`getOrCreateTimeSheet` logic to compare using date values, not `Date` objects interpreted in server timezone.
  - Update time-tracking session start/stop flows to persist `work_date`/`work_timezone`.
- `server/src/lib/api/services/TimeSheetService.ts`
  - If any endpoints derive “current period” or generate periods based on “today”, ensure “today” is user-local where needed (or explicitly tenant-local if it’s admin/system).

### Billing / Background Jobs
- `server/src/lib/billing/billingEngine.ts`
  - `rolloverUnapprovedTime(...)` mutates `start_time`/`end_time`; it must recompute and persist `work_date` accordingly (using the entry’s `work_timezone` if available, otherwise resolve via user timezone).

### Types / Schemas
- `server/src/interfaces/timeEntry.interfaces.ts`
  - Add `work_date` and `work_timezone` to the time entry interface(s) as appropriate.
- API Zod schemas in `server/src/lib/api/schemas/timeEntry.ts`
  - Ensure `work_date`/`work_timezone` are not client-writable; return them in responses if useful.

## Phases & To-Dos
### Phase 0 — Confirm invariants + timezone readiness
- Confirm `users.timezone` is populated in real environments; if not, define how it gets set (e.g., profile screen, onboarding, or a one-time “set timezone” prompt).
- Decide how strictly to enforce missing `users.timezone` (warn + fallback vs block time entry creation until set).
- Align on the definition of “user’s timezone” for service accounts/API clients (what timezone do we use when there is no interactive user?).

### Phase 1 — Database migration + backfill
- Add `work_date` and `work_timezone` columns to `time_entries` (start nullable).
- Migrate `time_periods.start_date/end_date` to `DATE` (timezone-agnostic) and update any dependent code/queries accordingly.
- Backfill existing rows:
  - Join to `users` to compute `work_date` using `users.timezone` when present.
  - Use fallback timezone when missing, and persist the fallback into `work_timezone`.
- Add NOT NULL constraints after backfill.
- Add indexes for expected query patterns (`(tenant, user_id, work_date)`, `(tenant, work_date)`).

### Phase 2 — Server actions write-path
- Update `saveTimeEntry` flow to compute/persist `work_date`/`work_timezone` from `start_time` in the user timezone.
- Ensure updates that modify `start_time` also update `work_date` (and keep `work_timezone` consistent).
- Ensure client-supplied `work_date`/`work_timezone` are ignored/rejected.

### Phase 3 — “Current period” and period membership logic
- Update `getCurrentTimePeriod()` to use the user’s local date (derived from `users.timezone`) when selecting a period.
- Audit any remaining “find period for date” logic to ensure it compares using date values and consistent half-open boundaries.

### Phase 4 — REST API alignment
- Update `TimeEntryService` create/update paths to compute/persist `work_date`/`work_timezone`.
- Update time-tracking session start/stop to populate these fields.
- Update period lookup + auto-timesheet creation to use `work_date` rather than server-interpreted `Date` comparisons.
- Update API schemas to treat `work_date`/`work_timezone` as server-controlled fields.

### Phase 5 — Frontend adjustments and regression fixes
- Update any UI “current period” indicator logic that uses UTC date strings to use the browser’s local date.
- Audit “quick add”/inline creation code paths that build timestamps from a displayed date and ensure they produce correct instants.
- Ensure all entry-creation entry points remain functional and land in the expected timesheet.

### Phase 6 — Billing/job correctness
- Update `BillingEngine.rolloverUnapprovedTime(...)` to recompute `work_date` whenever it adjusts timestamps.
- Search for any other code paths that mutate `time_entries.start_time`/`end_time` and ensure they also maintain `work_date`.

### Phase 7 — Tests, rollout, monitoring
- Add/extend tests covering timezone edge cases (entries around local midnight mapping to the expected period).
- Add a lightweight metric/log for “missing user timezone used fallback” to drive cleanup.
- Roll out behind a feature flag if desired, or deploy as a schema-first migration with dual-write then cutover.

## Open Questions
- For API integrations (no browser context), what is the expected timezone rule for `work_date`?
