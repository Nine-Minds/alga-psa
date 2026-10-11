# Scratchpad — ticket time-entry worked duration

- Plan slug: `2026-09-21-ticket-time-entry-worked-duration`
- Card: ALGA-2026-0002516
- Created: 2026-09-21

## Decisions

- Use one `workedMinutes` helper exported by `@alga-psa/core`; the utility must be client-safe because server actions, shared read models, and client components all consume it.
- Keep `billable_duration` in every existing model. It remains the billing value and the source of the established `> 0` billability classification.
- Do not add a derived `worked_duration` field to database rows or API/read-model types. The existing three fields are sufficient and avoiding a second derived value prevents drift.
- Show both explicit badge states (`Billable` and `Non-billable`) on the web ticket timeline and detailed time-entry rows.
- Recompute all ticket time summary totals and day buckets from worked duration so no ticket time surface disagrees with its per-entry display.
- Keep mobile out of this card: its ticket time-entry section is a separate UI/API path even though it has a similar presentation concern.
- No persistence, billing-engine, invoice, contract, schema, or migration changes.

## Discoveries / constraints

- `packages/tickets/src/components/ticket/bento/BentoTimelineTile.tsx` formats `timeEntry.billable_duration` in the time lane.
- `packages/tickets/src/components/ticket/bento/TimeLoggedSummary.tsx` sums `entry.billable_duration` for its headline and daily buckets.
- `packages/tickets/src/components/ticket/TicketTimeEntries.tsx` formats `entry.billable_duration` for each list row and displays server-computed own/other totals.
- `packages/scheduling/src/actions/timeEntryTicketActions.ts` already selects `start_time`, `end_time`, and `billable_duration`, but every total is based on `billable_duration`.
- `shared/lib/ticketActivity/readTicketActivity.ts` also already selects and returns all three fields for timeline entries; no query expansion is needed.
- `packages/tickets/src/actions/ticketBentoActions.ts` contains the desired private `workedMinutes` precedent and already distinguishes worked `totalMinutes` from billable rollup fields.
- `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx` sends zero billable duration for ad-hoc entries. `packages/scheduling/src/actions/timeEntryCrudActions.ts` preserves an explicit zero instead of replacing it with actual duration. That write behavior is intentional and out of scope.
- Across the application, `is_billable` is commonly derived from `billable_duration > 0`; the badge follows that existing persisted-field convention.
- `time_entries.start_time` and `end_time` are non-null in the schema, but a defensive helper fallback is still needed for redacted/legacy/test objects and the commissioned fallback requirement.
- Maintained ticket locale set: `de`, `en`, `es`, `fr`, `it`, `nl`, `pl`, `pt`; pseudo-locales: `xx`, `yy`.
- Worktree HEAD and `origin/main` were both `2dc8454a4c` during design.
- `package-lock.json` was already modified by environment setup. It is unrelated and must not be included in this card's plan or implementation commits without separate authorization.
- The worktree filesystem reported no available overlay space during design even though the host filesystem had capacity. Writing and committing the small plan succeeded only if the overlay admitted the new files; re-check before dependency installs/builds.

## Production evidence (read-only, identifiers stripped)

- On 2026-09-21, a parameterized read-only query against the named tenant from the card returned exactly one five-minute ticket entry with `billable_duration = 0`.
- Sanitized shape: start `2026-09-20T23:54:00Z`; end `2026-09-20T23:59:00Z`; worked minutes `5.00`; approval `DRAFT`; service present; contract line absent.
- No tenant ID, ticket ID, entry ID, user ID, or service ID is retained here.
- The wired local database had 1,099 ticket time entries and one generic positive-worked/zero-billable row (265 worked minutes), confirming the mismatch is not structurally unique to the reported record. It did not contain the exact five-minute record.

Read-only diagnostic shape for future verification (supply tenant as a parameter; do not paste identifiers into committed artifacts):

```sql
select
  start_time,
  end_time,
  round(extract(epoch from (end_time - start_time)) / 60.0, 2) as worked_minutes,
  billable_duration,
  approval_status,
  (service_id is null) as service_missing,
  (contract_line_id is null) as contract_line_missing
from time_entries
where tenant = $1
  and work_item_type = 'ticket'
  and billable_duration = 0
  and round(extract(epoch from (end_time - start_time)) / 60.0, 2) = 5;
```

## Expected implementation touch points

- `packages/core/src/lib/timeEntryDuration.ts` (new pure helper + tests)
- `packages/core/src/index.ts`
- `packages/tickets/src/actions/ticketBentoActions.ts`
- `packages/scheduling/src/actions/timeEntryTicketActions.ts`
- `packages/tickets/src/components/ticket/bento/TimeLoggedSummary.tsx`
- `packages/tickets/src/components/ticket/TicketTimeEntries.tsx`
- `packages/tickets/src/components/ticket/bento/BentoTimelineTile.tsx`
- `shared/lib/ticketActivity/__tests__/readTicketActivity.test.ts` and/or `server/src/test/integration/ticketActivityLog.integration.test.ts`
- Focused new component/action tests near the affected modules
- `server/public/locales/{de,en,es,fr,it,nl,pl,pt,xx,yy}/features/tickets.json`

## Commands / runbooks

- Focused core tests: `npm test --workspace=@alga-psa/core -- --run <worked-duration-test>`
- Focused tickets tests: `npm test --workspace=@alga-psa/tickets -- --run <affected-test-files>`
- Focused scheduling tests: `npm test --workspace=@alga-psa/scheduling -- --run <affected-test-files>`
- DB-backed timeline integration: `npm run test:integration --workspace=server -- --run src/test/integration/ticketActivityLog.integration.test.ts`
- Type checks: `npm run typecheck --workspace=@alga-psa/scheduling && npm run typecheck --workspace=@alga-psa/tickets`
- Locale generation/validation: `npm run test:i18n`

## Open questions

- None blocking for the web implementation. If mobile parity is desired, open or extend scope explicitly because its API and UI do not share these web components.
