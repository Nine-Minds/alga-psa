# Scratchpad — Ticket Work Description in New Time Entries

- Plan slug: `2026-09-21-alga-2026-0002517-ticket-work-description-time-entry`
- Created: 2026-09-21
- Internal card: `alga-2026-0002517`

## Decisions

- 2026-09-21: Seed `notes` with `workItem.description ?? ''` in both branches that construct a new entry. Nullish coalescing follows the commissioned fix and preserves any non-null string exactly.
- 2026-09-21: Do not change the `existingEntries` branch. Saved entry notes are authoritative while editing, regardless of the current work-item description.
- 2026-09-21: Test at the `TimeEntryProvider` initialization boundary because launcher coverage already proves `timeDescription` reaches `workItem.description`; the regression occurs after that handoff.

## Discoveries / Constraints

- 2026-09-21: `TicketBentoLayout.tsx` and `TicketProperties.tsx` bind the work-description input to `TicketDetails` state.
- 2026-09-21: `packages/tickets/src/lib/timeEntryContext.ts` maps that state to `TimeEntryWorkItemContext.timeDescription`.
- 2026-09-21: `packages/scheduling/src/lib/timeEntryLauncher.tsx` maps `timeDescription` to `IExtendedWorkItem.description`; an existing launcher test already asserts this mapping.
- 2026-09-21: `TimeEntryProvider.tsx` currently hardcodes `notes: ''` for both new-entry paths: one with supplied default times and one that derives its own time window.
- 2026-09-21: `TimeEntryDialog.tsx` preserves `entry.notes` in the save payload, so correcting initialization is sufficient.
- 2026-09-21: The fallback-time branch also handles ad-hoc scheduled items. Using the shared work-item description is consistent with the provider contract, but this broader shared behavior is a regression risk to cover with focused initialization tests.
- 2026-09-21: `package-lock.json` was already modified before plan work began. It is unrelated and must not be staged or altered.

## Implementation Touchpoints

- `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryProvider.tsx`
  - Replace `notes: ''` with `notes: workItem.description ?? ''` in both new-entry object literals.
- `packages/scheduling/tests/`
  - Add a focused provider initialization test covering supplied-time, fallback-time, nullish-description, and existing-entry behavior.

## Commands / Runbooks

```bash
npm --workspace @alga-psa/scheduling test -- --run <new-provider-test-file>
jq empty docs/plans/2026-09-21-alga-2026-0002517-ticket-work-description-time-entry/features.json
jq empty docs/plans/2026-09-21-alga-2026-0002517-ticket-work-description-time-entry/tests.json
git diff --check
```

## Risks

- A test that only covers `timeEntryLauncher` would miss the defect because that layer already carries the description correctly.
- The two new-entry branches are easy to update inconsistently; both require explicit assertions.
- Existing-entry notes must remain authoritative and must not be replaced by a possibly newer work-item description.
- The scheduling package's Vitest configuration selectively includes TSX suites; prefer a `.test.ts` provider test or explicitly update the include list if a TSX harness is necessary.

## Links / References

- Internal card: `alga-2026-0002517`
- `packages/tickets/src/components/ticket/bento/TicketBentoLayout.tsx`
- `packages/tickets/src/components/ticket/TicketProperties.tsx`
- `packages/tickets/src/components/ticket/TicketDetails.tsx`
- `packages/tickets/src/lib/timeEntryContext.ts`
- `packages/scheduling/src/lib/timeEntryLauncher.tsx`
- `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryProvider.tsx`
- `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx`
- `packages/scheduling/tests/timeEntryLauncher.test.tsx`

## Open Questions

- None for the scoped fix.
