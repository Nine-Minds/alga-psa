# Ticket time entries display worked duration independently of billability

**Card:** ALGA-2026-0002516
**Status:** Design complete; implementation not started
**Plan folder:** `ee/docs/plans/2026-09-21-ticket-time-entry-worked-duration/`

## Summary

Ticket time-entry presentation currently treats `billable_duration` as though it were elapsed work. That field is deliberately zero for non-billable entries, so a five-minute entry can appear as `0m` in the ticket timeline, detailed time-entry list, and time-logged totals even though its timestamps span five minutes.

Use one shared `workedMinutes` calculation for elapsed-work presentation: prefer the rounded `end_time - start_time` interval and fall back to `billable_duration` only when a usable interval is unavailable. Keep `billable_duration` unchanged as billing data and expose its existing billable/non-billable meaning through a separate badge.

## Problem

The web ticket experience has three conflicting interpretations of the same time entry:

- `BentoTimelineTile.tsx` formats `timeEntry.billable_duration`, so non-billable work displays `0m`.
- `timeEntryTicketActions.ts`, `TicketTimeEntries.tsx`, and `TimeLoggedSummary.tsx` use `billable_duration` for per-entry duration and totals, so the list, own/other totals, headline, and per-day chart all repeat the error.
- `ticketBentoActions.ts` already computes total worked minutes from `end_time - start_time` via a private `workedMinutes` helper, so the billing tile can disagree with the timeline and time-logged tile.

A read-only production check on 2026-09-21 confirmed exactly one reported-shape row for the tenant referenced by the card: a ticket entry spanning 23:54–23:59 UTC, with five worked minutes and `billable_duration = 0`. It is a draft entry with a service and no contract line. Identifiers are intentionally omitted. The wired local database also contains the same generic mismatch shape (positive timestamp duration with zero billable minutes), though not the exact five-minute record.

## Goals

1. Display five minutes for a five-minute ticket time entry even when it is non-billable and stores `billable_duration = 0`.
2. Use the same worked-duration rule in the bento timeline, detailed ticket time-entry rows, headline totals, own/other/hidden totals, and per-day chart buckets.
3. Preserve billing semantics: do not rewrite or reinterpret `billable_duration` for invoices, rates, contract usage, or persistence.
4. Show billability as a separate, localized badge on each visible time-entry row in the timeline and detailed list.
5. Retain the current authorization, tenant isolation, visibility/redaction, edit/delete, and refresh behavior.
6. Reuse one client-safe `workedMinutes` implementation rather than repeating timestamp arithmetic in each consumer.

## Non-goals

- Changing time-entry creation or update behavior in `TimeEntryDialog.tsx`, `timeEntryCrudActions.ts`, or the public API.
- Backfilling or migrating existing `time_entries` rows.
- Changing invoice, contract, profitability, timesheet, utilization, or other billing calculations that intentionally use `billable_duration`.
- Displaying billable minutes alongside worked minutes or explaining billing rules in the ticket UI.
- Changing the ticket billing tile's `billableMinutes` and `uninvoicedBillableMinutes` values; only its existing worked-total calculation is moved to the shared helper.
- Updating the separate Expo/mobile ticket time-entry surface. This card covers the named web ticket timeline/list/totals paths; mobile has its own duration helper and UI and should be handled separately if parity is required.

## Users and primary flows

- **Technician reviewing a ticket:** opens the ticket timeline and sees `5m` plus a `Non-billable` badge for the confirmed entry instead of `0m`.
- **Technician reviewing logged time:** opens the Time logged tile and sees each row's worked duration, explicit billability, and totals/day bars that include non-billable work.
- **Manager with broader time-entry visibility:** own, visible-team, hidden-team, and overall totals use worked duration while the existing authorization decision still controls which entry details are shown.
- **Billing user:** billing-specific values remain based on `billable_duration`; no invoice or contract behavior changes.

## UX / UI notes

### Timeline row

Keep the existing compact sentence and duration chip. Replace the chip's value with `workedMinutes(timeEntry)`. Add a small adjacent badge:

- `Billable` when `billable_duration > 0`.
- `Non-billable` when `billable_duration <= 0`.

The duration remains the primary visual value. The badge communicates classification and must not substitute `0m` for elapsed work.

### Detailed ticket time-entry row

Replace the right-aligned duration value with `workedMinutes(entry)`. Add the same billability badge beside the duration, while retaining the approval-status badge on the metadata row and keeping edit/delete controls unchanged.

### Time logged summary

The headline, own/other/hidden totals, and per-day bars all sum `workedMinutes(entry)`. Existing date bucketing, entry counts, pluralization, and accessibility text remain unchanged except that their minute values now represent worked time.

### Localization

Add `timeEntries.billable` and `timeEntries.nonBillable` to the eight maintained locale files under `server/public/locales/*/features/tickets.json`, then regenerate `xx` and `yy`. Reuse these keys in both ticket components; do not introduce hard-coded badge copy.

## Requirements

### Functional requirements

1. Add a client-safe `workedMinutes` utility in `@alga-psa/core` and export it from the core barrel.
2. The utility accepts the timestamp and billing fields already present on both `TicketTimelineTimeEntry` and `TicketTimeEntrySummaryEntry`.
3. When both timestamps form a valid interval, return the rounded elapsed minutes from `end_time - start_time`, matching the existing `ticketBentoActions.ts` calculation.
4. When a usable interval is unavailable, fall back to a finite numeric `billable_duration`; fall back to zero only when neither source is usable.
5. Do not mutate the input object.
6. Remove the private duplicate from `ticketBentoActions.ts` and import the shared utility, preserving `totalMinutes` as worked time and all billable rollup fields as billable time.
7. In `fetchTimeEntriesForTicketCore`, compute all own/other/visible/hidden/overall minute totals with `workedMinutes(row)` while preserving the returned `billable_duration` field.
8. In `TimeLoggedSummary.tsx`, use `workedMinutes(entry)` for the headline and each per-day bucket.
9. In `TicketTimeEntries.tsx`, use `workedMinutes(entry)` for each visible row and render localized billability separately.
10. In `BentoTimelineTile.tsx`, use `workedMinutes(timeEntry)` for the timeline duration chip and render localized billability separately.
11. Derive billability using the application's established persisted-field rule: finite `billable_duration > 0` is billable; zero is non-billable.
12. Preserve all existing permission checks, redaction behavior, ordering, refresh behavior, automation IDs, and edit/delete callbacks.

### Non-functional requirements

- The shared calculation is deterministic and timezone-independent because it subtracts absolute timestamps.
- No additional database query is added; both existing readers already select `start_time`, `end_time`, and `billable_duration`.
- No new client/server boundary is introduced; the helper contains no server-only dependencies.
- Badge text is localized and pseudo-locales remain synchronized.

## Data / API / integrations

- No database schema or data migration.
- No public API contract change.
- `TicketTimelineTimeEntry` and `TicketTimeEntrySummaryEntry` already carry the three required fields, so no `worked_duration` field is added and no duplicate derived value crosses the server/client boundary.
- `billable_duration` stays in the read models for billing classification and editing. The fix changes only derived presentation values and summary math.
- `readTicketActivity.ts` continues selecting and normalizing the existing fields; its DB-backed integration test is extended to cover the non-billable positive-worked-duration shape.

## Security / permissions

- Keep the current ticket-read and time-entry-read authorization gates unchanged.
- Continue to aggregate hidden teammate entries only through the existing authorized summary flow; this change swaps the duration measure but does not reveal timestamps, notes, services, users, or entry identifiers.
- Keep all database reads tenant-scoped. The production diagnostic was read-only and no tenant/record identifiers are retained in this plan.

## Implementation outline

1. Add and unit-test `workedMinutes` in `packages/core/src/lib/timeEntryDuration.ts`; export it from `packages/core/src/index.ts`.
2. Replace the private helper in `packages/tickets/src/actions/ticketBentoActions.ts` with the shared import.
3. Update `packages/scheduling/src/actions/timeEntryTicketActions.ts` so every ticket summary total uses worked minutes while each entry still exposes its original `billable_duration`.
4. Update `packages/tickets/src/components/ticket/bento/TimeLoggedSummary.tsx`, `packages/tickets/src/components/ticket/TicketTimeEntries.tsx`, and `packages/tickets/src/components/ticket/bento/BentoTimelineTile.tsx` to use the shared helper.
5. Add explicit Billable/Non-billable badges to the timeline and detailed list, with shared locale keys across maintained and pseudo locale files.
6. Extend the existing ticket activity integration seam and add focused summary/component/i18n tests.

## Risks

- **Worked and billable time can legitimately differ.** This is the point of the change, but reviewers may mistake the new visible value for an invoice value. The separate badge and untouched billing rollups keep the distinction explicit.
- **Legacy malformed timestamps.** The shared helper must handle missing or invalid dates without rendering `NaN` or crashing a client component; the documented fallback and unit tests cover this.
- **Authorization/redaction totals.** The summary action performs authorization per row. Duration must be computed from the raw row for authorized aggregation, while redacted visible entries must still render safely using the helper fallback.
- **Rounding drift.** All consumers must call the same helper so a sub-minute timestamp does not round differently across the timeline, list, and totals.
- **Locale drift.** Adding only English would leave untranslated keys or pseudo-locale failures; update all maintained locales and regenerate both pseudo-locales.
- **Mobile parity.** The mobile ticket time-entry view remains a separate consumer and may continue to present its current semantics. This is deliberately out of scope and called out to avoid implying product-wide parity.
- **Dirty worktree.** `package-lock.json` was already modified by environment setup before this plan. Implementation and commits must continue to exclude that unrelated change unless separately authorized.

## Rollout / migration

Code-only rollout with no feature flag and no migration. Existing rows render correctly immediately because worked duration is derived at read/render time. Billing output is unchanged.

## Open questions

None blocking. The commissioned fix defines worked duration and requires separate billability. The plan makes both states explicit with a badge and limits scope to the named web ticket surfaces.

## Acceptance criteria / definition of done

- [x] The reported production row shape is confirmed read-only: five timestamp minutes, zero billable minutes, ticket entry; no tenant-scoped identifier is retained in plan artifacts.
- [ ] A five-minute non-billable ticket entry renders `5m` in the bento timeline and carries a localized `Non-billable` badge.
- [ ] The same entry renders five worked minutes in the detailed ticket time-entry list and contributes five minutes to the headline, own/other/hidden/overall totals, and its day bucket.
- [ ] A billable entry renders its timestamp-derived worked duration and a localized `Billable` badge even when its billable duration differs because of rounding or minimums.
- [ ] Missing/unusable timestamps fall back to `billable_duration` without `NaN`, negative display artifacts, or a client crash.
- [ ] The ticket billing rollup continues to report worked `totalMinutes` separately from billable and uninvoiced-billable minutes.
- [ ] No time-entry persistence, invoice, contract, or public API behavior changes.
- [ ] Tenant isolation, time-entry authorization, redaction, edit/delete behavior, ordering, and refresh behavior remain intact.
- [ ] Focused core, action, component, DB-backed integration, and i18n tests pass.
