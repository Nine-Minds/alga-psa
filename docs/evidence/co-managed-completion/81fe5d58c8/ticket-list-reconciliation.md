# CF001 — reconciliation of the 39 unchecked ticket-list rows

The ticket-list unification plan (`docs/plans/2026-09-11-co-managed-ticket-list-unification/`)
carries 21 features and 18 tests with `implemented: false`. The inventory derived
`missing-code` from that flag alone, which is the right default and the wrong
final answer: it cannot tell *nobody built this* apart from *this is two thirds
built*, and the difference decides whether the next round writes code or writes
a test.

Every row below was reconciled by reading the code. Method: locate the behaviour
the row describes in `packages/tickets/src/{lib,components,actions}`,
`server/src/components/{co-managed,tickets}` and `server/src/app/msp/tickets`,
and record file:line for what exists and an explicit negative for what does not.
A name match was not accepted as implementation.

## Outcome

| verdict | count | rows |
|---|---|---|
| satisfied → `implemented-unverified` | **7** | F012, F015, F021, F029, F036, T003, T014 |
| partial → stays `missing-code` | 24 | F003, F010, F017, F020, F024, F025, F027, F028, F030, F031, F032, F038, F039, T002, T004, T005, T007, T009, T010, T012, T015, T016, T017, T018 |
| searched, no code → stays `missing-code` | 8 | F006, F022, F026, T006, T008, T011, T013, T019 |

Partial rows keep `missing-code` on purpose — a requirement two thirds met is
not met — but each now names the missing third, so the list is actionable rather
than uniform.

## Where the implementation actually lives

- `packages/tickets/src/lib/ticketListScope.ts` — scope/presentation URL contract
- `packages/tickets/src/lib/ticketListIdentity.ts` — native/shared row identity, handback eligibility
- `packages/tickets/src/lib/ticketListUrlSync.ts` — navigation-in-flight URL guard
- `packages/tickets/src/components/TicketListShell.tsx` — layout-only frame (67 lines)
- `server/src/components/co-managed/QualifiedTicketList.tsx` — the qualified list body
- `server/src/components/co-managed/CoManagedTicketHandbackComposer.tsx` — the single composer
- `server/src/app/msp/tickets/page.tsx:117` — the scope-first SSR branch

Still present and **un-retired**: `CoManagedTicketQueue.tsx` and
`CoManagedTicketBulkHandback.tsx` — the duplicate standalone list and checklist
that F028/F039 exist to remove, each still carrying live tests.

## Three structural findings worth more than the row statuses

**1. `TicketListShell` was written as a parallel frame, not extracted from the
dashboard.** F010 asks for extraction *from the actual dashboard frame*; the
shell exists with the right slots but its only consumer is the qualified list
(`QualifiedTicketList.tsx:346`). `TicketingDashboard.tsx` never imports it and
still renders heading/actions/board inline (`:2245`). So the native structure the
row exists to preserve does not go through the shared frame at all — and T005,
which asks for "the native dashboard rendered through the new frame", has no
subject until that changes. This is the row to fix first: F017, T005 and part of
F039 all sit downstream of it.

**2. The component tests point at the components this plan intends to retire.**
`coManagedTicketQueue.test.tsx` and `coManagedTicketBulkHandback.test.tsx` carry
exactly the assertions T007, T010, T012 and T015 describe — against
`CoManagedTicketQueue` and `CoManagedTicketBulkHandback`. Retiring those
components per F028/F039 would delete the only coverage those four tests have.
The tests must be re-pointed at `QualifiedTicketList` *before* the retirement,
not after.

**3. No test file anywhere renders the new components.** Not
`QualifiedTicketList`, not `TicketListScopeBar`, not `TicketListShell`, not
`CoManagedTicketHandbackComposer`, not `CoManagedTicketQueueLegacyAdapter`. The
highest-value single gap is T013: the composer's session-recovery path
(`CoManagedTicketHandbackComposer.tsx:27-58, :159-174`) implements versioning, a
24-hour expiry, actor-scoped keys and a deliberate no-auto-submit-on-restore
rule, and none of it is tested. That is uncertain-handback recovery — the case
where getting it wrong duplicates or loses customer work.

## What this evidence does and does not establish

It establishes what **exists**. It is a code read, not an execution, so it can
move a row to `implemented-unverified` and can never move one to `verified`.
No row was moved on a name match; the two test rows that moved (T003, T014) cite
specific case ranges in
`ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts`,
which is the file that runs 1418/1418 locally.
