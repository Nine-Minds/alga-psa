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
| `time-periods/timePeriods` | 0/8 | **8/8** |
| `projects/projectPermissions` | 0/7 | **7/7** |
| `tickets/ticketPermissions` | 0/5 | **5/5** |
| `projects/projectManagement` | 0/11 | **11/11** |
| `credits/creditExpirationEffects` | 0/4 | **4/4** |
| `credits/creditExpirationIntegration` | 1/2 | **2/2** |
| `credits/creditExpirationPriority` | 2/3 | **3/3** |
| `credits/creditServiceTypeRestrictionModeMigration` | 5/7 | **7/7** |
| `credits/creditExpirationCore` | 0/4 | **4/4** |
| `invoices/billingInvoiceGeneration_subtotal` | 1/5 | **5/5** |
| `invoices/negativeInvoiceCredit` | 0/6 | **6/6** |
| `invoices/contractInvoiceManualCredit` | 0/2 | **2/2** |
| `invoices/prepaymentInvoice` | 4/11 | **11/11** |
| `quotes/quoteInfrastructure` | 76/83 | **83/83** |
| `pricingSchedules/pricingScheduleRateOverrides` | 0/5 | **5/5** |
| `invoices/multiCurrency` | 0/3 | **3/3** |
| `invoices/billingInvoiceGeneration_consistency` | 0/1 | **1/1** |
| `invoices/billingInvoiceGeneration_edgeCases` | 0/2 | **2/2** |
| `invoices/fixedPriceAndTimeBasedPlans` | 0/3 | **3/3** |

The time-periods pair also dropped from 180s for one file to 35s for both.

A whole-suite baseline taken partway through this round: **13 files / 49 tests
failing out of 354**. Everything above is now green file-by-file.

### The four fixture faults behind almost all of it

Worth knowing before touching any billing fixture, because every suite above
tripped over at least one:

1. **Contracts need `owner_client_id`.** Invoice generation resolves a
   window's recurring service periods through
   `recurring_service_periods -> contract_lines -> contracts -> clients` on
   that column. An ownerless contract yields no periods and the run comes back
   as `Recurring service periods were not materialized`, which the tests then
   report as "expected undefined to be …".
2. **Arrears shifts the window by a cycle.** A billing cycle's period is the
   *invoice* window; an arrears line bills the service period before it. Both
   `contract_lines.billing_timing` and `createFixedPlanAssignment` default to
   arrears, so assignments have to start a cycle earlier than the cycle under
   test — and the window has to be a whole period, since it is matched on the
   exact `invoice_window_start`/`invoice_window_end` pair.
3. **Materialize last, and only when asked.** `createFixedPlanAssignment`
   materializes only with `materializeServicePeriods: true`, and the sync reads
   the line's service configuration, so it has to run after the extra services
   are attached and after the line is on its final contract.
4. **Hand-built lines are incomplete.** `contract_lines.is_template` defaults
   to `true`, and a Fixed line also needs its
   `contract_line_service_fixed_config` and `contract_line_services` rows or it
   produces no charges and `generateInvoice` returns null.

### Still failing after this round

| File | Failing | Shape |
|---|---|---|
| `invoices/clientBillingCycleAnchors` | 3/7 (was 4) | changing a client's anchor deactivates future billing cycles and does not supersede/regenerate the client-cadence periods the T083/T086 cases expect. Behavioural: either the product regressed or the requirement moved, and neither is a fixture edit. The fourth failure was a mocking fault and is fixed — see below. |
| `invoices/usageBucketAndFinalization` | 1/3 | see defect 6 below |

### A mock that does not reach across package boundaries

`testMocks.ts` declares `vi.mock('@alga-psa/auth/rbac', …)` at module scope, and
suites rely on importing it to get permission mocking for free. That works for
some files and not others: in `clientBillingCycleAnchors` the same
`hasPermission` returned `true` when the *test* called it and denied when
`billingCycleActions` called it — two module instances, one mocked and one not.
The fix is to declare `vi.mock('@alga-psa/auth/rbac', …)` in the test file
itself, which is what the unit suites already do. Treat the shared declaration
as a convenience, never as a guarantee.

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

`projectManagement`'s model mocks are gone (round 2). It mocked `ProjectModel`
/ `ProjectTaskModel` to return fabricated rows while the actions insert and
reload from the database — "Created project could not be reloaded after
insert". It now runs the real DB path, which is what its place in
`src/test/infrastructure` implies, and asserts on persisted rows instead of
`toHaveBeenCalledWith`. Three further fixture facts came out of that:

- The acting user must be a **real row**. The authorization kernel narrows on
  `team_members.user_id`, and the default mock id `'mock-user-id'` is not a
  uuid; that query errored *inside the action's transaction*, so the next
  statement failed with the unhelpful "current transaction is aborted".
- `addProjectPhase` validates against the full phase schema, so `wbs_code` must
  be present even though the action immediately replaces it.
- `project_tasks.estimated_hours` is `numeric`, which pg returns as a string.

## Cluster D — FK cleanup order (~3 failures)

`cleanupTables` deletes in reverse array order, and every client gets an eager
default billing profile (`testContext.ts` provisions it the way production
does), so deleting `clients` first trips
`client_billing_profiles_client_id_fkey`. The two permissions suites list
`client_billing_profiles` after `clients` now.

Round 2 removed those hand-written cleanup hooks from the two permissions
suites outright. `permissions` cannot be deleted while `role_permissions`
references it, and that error **aborts the surrounding transaction**, so every
later statement in the hook failed with "current transaction is aborted". The
per-test rollback already discards the fixture rows.

## Cluster F — who the action thinks it is (round 2)

Three separate seams decide the acting identity, and the suites were wired to
the wrong one in each case.

- **`withAuth` establishes tenant context; the mock did not.** The real wrapper
  runs the action inside `runWithTenant`, and code below the action reads the
  tenant straight off that AsyncLocalStorage store (`requireTenantId` in tag
  cleanup, `getTenantContext` in scheduling). `createAuthModuleMock`'s
  `withAuth` called the action bare, so deleting a project died on "tenant
  context not found". `TestContext` had the mirror problem: its `runWithTenant`
  spy was `(_tenant, fn) => fn()`, an empty store, so a suite that *explicitly*
  wrapped a call in `runWithTenant` still got "Tenant context is required".
  Both now delegate to the real implementation, pinned to the suite tenant.
- **Two specifiers for one `hasPermission`.** `testMocks` mocks
  `@alga-psa/auth/rbac`, `server/src/lib/auth/rbac` and `@/lib/auth/rbac`, all
  routed through `permissionCheckRef`. `projectPermissions` instead patched
  `@alga-psa/auth`'s export, which `projectActions` does not import — the rbac
  mock stayed on its default ("no roles ⇒ allow everything", because DB user
  rows carry no `roles` array), and the *regular* user was allowed to update,
  create and delete. Reprogram the predicate through `setupCommonMocks` /
  `mockRBAC`, never a single specifier.
- **Trailing user arguments are ignored.** `getTickets`, `updateTicket` and
  `addTicket` are `withAuth`-wrapped and take their user from the session;
  `ticketPermissions` still passed `adminUser` / `regularUser` as a trailing
  argument, which landed in `options` (or nowhere). Every call ran as the
  session stub, so the admin was denied and the "denied" assertions passed for
  the wrong reason.

Also fixture drift, found once the identity was right: a ticket's status must
belong to its board (`TicketModel.validateStatusBelongsToBoard`), so a
boardless status can never create a ticket.

## Cluster G — derived credit balance and job connections (round 2)

- **Available credit excludes credits whose date has passed.**
  `getAvailableCredit` filters `is_expired = false` **and**
  `expiration_date > now()`. The expiration suites asserted a pre-job balance
  that still counted a credit issued with a past expiration date — true of the
  old cached `clients.credit_balance`, false of the derived one. The
  "not processed yet" state lives in `credit_tracking`, and the assertions read
  it there now.
- **Invoice totals are immutable after finalization.**
  `applyCreditToInvoiceInternal` never writes `total_amount`; balance due is
  `total_amount - credit_applied` (`creditApplication.test.ts` already encodes
  this). Three suites still expected a rewritten total, and their manual
  fallback helpers wrote one, so the two paths disagreed. Both now leave totals
  gross.
- **Job handlers open their own connection.** `expiredCreditsHandler` calls
  `getConnection(tenantId)` rather than `createTenantKnex()`, so `TestContext`'s
  spy does not reach it. That second connection cannot see rows written inside
  the suite transaction and blocks on their locks — a 120-second timeout, not a
  failure. Mock `getConnection` to hand back `context.db`, as
  `billing/quotes/expireQuotesHandler.test.ts` already does.
- **Constraints that a later migration dropped.** Two
  `creditServiceTypeRestrictionModeMigration` tests asserted CHECK arms that
  `20260817130000` deliberately removed (the tenant-side NOT NULL could not be
  installed on the hosted Citus cluster). They now pin the arrangement that
  replaced them: no database constraint, and the mode/ids pairing normalized on
  the write path by `updateClientBillingSettings`.

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

### 3. `revalidatePath` invariant in `timePeriodsActions` — FIXED HERE

Time-period tests failed with `Invariant: static generation store missing in
revalidatePath /msp/time-entry`. `createTimePeriod` carried a hand-rolled
try/catch; the other four call sites did not, and two of them sit inside a
`catch` that inspects `error.message` for "belongs to different tenant", so a
failed revalidation surfaced as a bogus tenant error. These actions also run
from background jobs and the billing bootstrap, where there is never a request
context, so this was a live defect and not only a test artefact. All five now
go through one module-local `safeRevalidate`, matching the helper
`packages/billing/src/actions/serviceActions.ts` and
`packages/inventory/src/actions/kitActions.ts` already use.

### 4. Daily time periods were a day short — FIXED HERE

Time periods are half-open intervals `[start, end)` —
`TimePeriod.findOverlapping` says so in as many words, and `generateTimePeriods`
plus the `week` / `year` arms of `TimePeriodSuggester.suggestNewTimePeriod` all
add the whole frequency. The `day` arm added `frequency - 1`, so the
create-next-period path produced 6-day periods from a 7-day setting while the
bulk generator produced 7-day ones for the same settings row. Fixed in
`packages/scheduling/src/lib/timePeriodSuggester.ts`.

Two neighbours left alone deliberately:

- `TimePeriodSuggester.calculateEndDate` (used by `TimePeriodForm` to prefill
  the end date) uses an inclusive convention throughout — `months - 1 day`,
  `years - 1 day`. Whether the form should agree with the generator is a UI
  question, not a test-repair one.
- `server/src/lib/timePeriodSuggester.ts` is a stale copy no product code
  imports — but `server/src/test/unit/timePeriodSuggester.test.ts` imports *it*
  rather than the package, so that unit test covers dead code. It also has no
  `day`-unit case, which is why the bug above survived. Worth folding into the
  package copy.

### 5. `updateTaskSchema` undid its own `.partial()` — FIXED HERE

`updateTaskSchema` is `projectTaskSchema.partial().omit({…}).extend({…})`, and
`.extend` replaces a key outright rather than merging into it. `service_id`
restated `.optional()`; `assigned_to` did not. Every partial task update that
omitted `assigned_to` — which is what a partial update means — was rejected
with `Please fix the task details: assigned_to: Invalid input`. Fixed in
`packages/projects/src/schemas/project.schemas.ts`; the stale copy at
`server/src/lib/schemas/project.schemas.ts` has the same shape and the same
bug, and is a candidate for the same deletion as the suggester copy above.

### 6. Bucket overage is billed per minute at the hourly rate — OPEN

`usageBucketAndFinalization`'s overage case records 45 hours against a 40-hour
bucket (`minutesUsed: 45 * 60`, `overageMinutes: 5 * 60`) on a service whose
`unit_of_measure` is `hour` and whose rate is 7500 (`$75.00/hour`). The
expected charge is 5 × 7500 = 37500; the engine produces **2250000**, which is
300 × 7500 — the overage *minutes* multiplied by the hourly rate.

Either `computeBucketCharges` must convert to the service's unit of measure
before applying the rate, or `bucket_usage.overage_minutes` is misnamed and
the fixtures should store hours. That is a product decision, so the test is
left failing rather than adjusted to whichever answer makes it pass. The same
case also reports `tax: 0` where 3750 is expected, so overage charges appear
not to be taxed at all — likely the same charge-construction path.
