# P1 — infrastructure-full cluster work: what was fixed and what it exposed

Companion to `plan.md`. Records the root causes found while working the
failure clusters, and the product defects the repairs uncovered (P1 says to
raise those as their own tickets rather than paper over them).

Local repro used throughout: one file at a time against a scratch database
(`TEST_DB_NAME=test_mc8 … npx vitest run src/test/infrastructure/<file>`).

Verified locally, file by file:

| File | Before | After |
|---|---|---|
| `invoices/invoiceNumberGeneration_part2` | 0/9 | **9/9** |
| `invoices/billingInvoiceGeneration_tax` | 0/9 | **9/9** |
| `time-periods/timePeriodsActions` | 0/1 | **1/1** |
| `time-periods/timePeriods` | 0/8 | 5/8 (rest: open defects below) |
| `projects/projectPermissions` + `tickets/ticketPermissions` | 0/12 | 5/12 |
| `projects/projectManagement` | 0/11 | 0/11, but ~16 min of rebuild time gone |

The time-periods pair also dropped from 180s for one file to 35s for both.

## Cluster A — connection cascade (~35 failures, most of the timeouts)

`resetDatabase(db)` destroys the pool of the handle it is given, then drops and
recreates the database. Five infrastructure files called it from `beforeEach`:

| File | Effect |
|---|---|
| timePeriods, timePeriodsActions, ticketPermissions, projectPermissions | called it with `context.db`, which is the TestContext *transaction* — the drop killed the connection, so every later query failed "Client has encountered a connection error and is not queryable" |
| projectManagement | called it with its own root connection in `beforeAll` *and* `beforeEach` — "Unable to acquire a connection" from the first query onward |

Fixed by using `TestContext.reset()` (transaction rollback) in the four
context-based files, and a one-time bootstrap plus table cleanup in
projectManagement. `resetDatabase` now rejects a transaction handle outright.

Side effect worth noting: each `resetDatabase` call re-migrated and re-seeded
the database, roughly 90s per test. The time-periods pair went from 180s for
one file to 35s for both.

projectManagement also mocked the default tenant id
(`11111111-1111-1111-1111-111111111111`), which has no rows in the seeded
database; it now reads the seeded tenant.

## Cluster B — `clients.credit_balance` (schema drift)

The column was dropped by
`20260728120000_derive_credit_balance_drop_cache_and_reconciliation.cjs`.
Forty of the 46 references were inert (`createClient` never forwarded the
option), but the expiration suites updated and asserted the cache. Balance now
comes from `credit_tracking` through `getAvailableCredit` / `getClientCredit`,
which is where the product reads it.

## Cluster C — "invoice_id undefined" (~10 failures)

Not an undefined binding at all: `generateInvoice` was returning an action
error, and `expect(invoice!.invoice_number)` reported the symptom.

The real error is `Recurring service periods were not materialized for this
client billing schedule window`, and it has three causes in the fixtures:

1. **Arrears window shift.** A billing cycle's `period_start_date` /
   `period_end_date` is the *invoice* window; an arrears schedule invoices the
   service period **before** it. Fixtures materialized from the cycle start, so
   the window had no row. Assignments must start one cycle earlier.
2. **Every active line needs a row.** `generateInvoice` fails the whole run if
   any active recurring contract line lacks a period for the window, so fixture
   helpers that create a second line must materialize it too
   (`materializeServicePeriods: true`).
3. **Re-assignment retires periods.** Calling `assignContractLineToClient`
   again for a later cycle re-anchors the schedule and retires the period the
   next cycle bills. The follow-up assignments were redundant and are gone.

`invoiceNumberGeneration_part2` went from 0/9 to 9/9 with those three changes.
The same shape applies to the other invoice-generating families.

## Cluster E — fixture drift found while unblocking A and C

Once the connection cascade was gone, these suites failed on their own
staleness:

- **Fresh-tenant fixtures.** `createTestEnvironment` mints a *new* tenant, which
  has none of the seeded statuses or priorities. `projectPermissions` and
  `ticketPermissions` looked up the seeded "Initiating Spell" status in it and
  threw. They use the context's seeded tenant now.
- **TRUNCATE CASCADE inside the test transaction.** The same two suites listed
  `clients`/`users` in `cleanupTables`; `TRUNCATE ... CASCADE` took the seeded
  statuses and priorities with them for the rest of the file. The per-test
  transaction rollback already provides the isolation, so the lists are gone.
- **Schema drift in fixture rows.** `projects.project_number` is NOT NULL and
  unique per tenant; `tickets.estimated_hours` no longer exists.
- **Roleless admin.** `createMockUser` leaves `roles: []` and the default RBAC
  mock reads them, so the "admin" fixture was denied every action.

Still open: `projectManagement` mocks `ProjectModel` / `ProjectTaskModel` to
return fabricated rows, and the actions now insert and reload from the
database — "Created project could not be reloaded after insert". That file
wants its model mocks dropped so it exercises the real DB path, which is what
its place in `src/test/infrastructure` implies. Its 11 failures are unchanged
in count, but it no longer rebuilds the schema once per test.

## Cluster D — FK cleanup order (~3 failures)

`cleanupTables` deletes in reverse array order, and every client gets an eager
default billing profile (`testContext.ts` provisions it the way production
does), so deleting `clients` first trips
`client_billing_profiles_client_id_fkey`. The two permissions suites list
`client_billing_profiles` after `clients` now.

## Product defects exposed (tickets, not test edits)

### 1. `generateTimePeriods` never terminated on a fixed end day — FIXED HERE

With `frequency_unit: 'month'` and `end_day: 15`, `getEndOfPeriod` returns the
15th of the current month, and the loop assigned that back to `currentDate`;
the next iteration computed the same date and pushed a zero-length period
forever. Any tenant with a semi-monthly settings row hangs the server action
and grows the heap without bound — the infrastructure suite died at 8 GB.

Fixed in this branch (`packages/scheduling/src/actions/timePeriodsActions.ts`)
because an OOM takes the whole CI worker with it: a fixed end day advances to
the next occurrence of `start_day`, which is what the dead `if` branch it
replaces was written to do, with a no-progress guard behind it.

### 2. `timePeriodSettingsSchema` rejects the NULLs the table allows — OPEN

`start_month`, `start_day_of_month`, `end_month`, `end_day_of_month` are
`.optional()`, which zod fails on `null`. `getActiveTimePeriodSettings`
coalesces the NULLs before validating; the three call sites in
`timePeriodsActions.ts` (lines 134, 166, 641) validate raw rows and throw
`ZodError` on any row holding a NULL.

Rows written through `createTimePeriodSettings` always carry defaults, so the
app path is safe today — the exposure is any row inserted by another path
(imports, fixtures, hand-written SQL). Suggested fix: `.nullish()` on those
four fields, in `packages/scheduling/src/schemas/timeSheet.schemas.ts` **and**
the stale copy at `server/src/lib/schemas/timeSheet.schemas.ts`. The fixtures
in this branch fill the columns instead, matching what the app writes.

### 3. `revalidatePath` invariant in `generateAndSaveTimePeriods` — OPEN

Two time-period tests fail with `Invariant: static generation store missing in
revalidatePath /msp/time-entry`: the action calls `revalidatePath` outside a
request context and `next/cache` is only mocked for callers that route through
`setupCommonMocks`. `createNextTimePeriod` already guards its own call with a
comment that revalidation "only works in request context"; the same guard
belongs on the generate path.
