# Recurring Service-Period Replenishment Plan

## Status

Approved under the card's `conn` delegation for Draft Implementation.

## Problem

The nightly `createClientContractLineCycles` job advances
`client_billing_cycles`, but it does not replenish the canonical
`recurring_service_periods` ledger. A client can therefore have a valid new
invoice window while an arrears or advance obligation has no row for the
service period due in that window. Automatic invoice generation then reports a
materialization gap and requires the operator to run **Fix all**.

The production example is an arrears schedule where the 2026-08-01 to
2026-09-01 billing cycle existed, but the 2026-07-01 to 2026-08-01 service
period that should invoice in that window did not.

## Existing architecture

- `packages/billing/src/lib/billing/createBillingCycles.ts` is the shared
  boundary used by both the nightly scheduler and the manual next-cycle action.
- `server/src/lib/initializeApp.ts` already runs that boundary once per active
  client every 24 hours.
- `shared/billingClients/clientCadenceScheduleRegeneration.ts` already loads
  active client-cadence lines, derives advance versus arrears windows, clips
  candidates to assignment dates, preserves billed history, supersedes only
  mutable drift, and inserts missing rows idempotently.
- `shared/billingClients/materializeClientCadenceServicePeriods.ts` uses the
  common 180-day generation horizon and 45-day replenishment threshold.

## Decision

Replenish the affected client's client-cadence service periods immediately
after successful billing-cycle advancement, in the same per-client
transaction. Also replenish on a successful no-op nightly pass so the moving
180-day horizon stays full even when no new cycle row is needed that day.

Do not add another recurring job and do not call the tenant-wide repair action
from the nightly client loop. A targeted hook is cheaper, covers manual and
automatic creation, and makes the invariant true at the mutation boundary.

## Detailed design

### 1. Expose a targeted replenishment operation

In `shared/billingClients/clientCadenceScheduleRegeneration.ts`:

- Extract the compute-and-persist body of
  `regenerateClientCadenceServicePeriodsForScheduleChange` into an exported
  `replenishClientCadenceServicePeriods` operation.
- Accept the existing transaction plus tenant, client id, billing cycle, and
  normalized anchor settings. Reuse `computeClientCadenceRegeneration` and
  `persistRecurringServicePeriodRegeneration`; do not create a second
  materialization algorithm.
- Keep the existing schedule-change export as a compatibility wrapper around
  the new operation.
- Return a small summary only if useful for logging. Database state remains the
  authoritative result.

The canonical flow remains:

1. Load all active, non-system-managed client contracts and client-cadence
   recurring lines for the client.
2. Start regeneration at the later of assignment start and billed-history end.
3. Materialize through the shared horizon for the line's advance or arrears
   due position.
4. Clip candidates to assignment end.
5. Use `backfillRecurringServicePeriods` to preserve billed/overridden rows,
   supersede mutable drift, and insert missing records.
6. Persist only the delta; a matching ledger writes nothing.

Contract-cadence lines stay out of scope because client billing-cycle
advancement does not define their anniversary schedule.

### 2. Make cycle advancement and replenishment one transaction

In `packages/billing/src/lib/billing/createBillingCycles.ts`:

- Wrap one invocation of `createClientContractLineCycles` in
  `withTransaction`.
- Move cycle lookup/insertion into the transaction and pass that transaction to
  `createBillingCycle`.
- Centralize successful exits so every successful path calls the targeted
  replenishment operation with the already loaded cycle and anchor settings:
  initial automatic creation and catch-up, existing-cycle catch-up, manual
  next-cycle creation, and automatic no-op when coverage is current.
- Preserve existing duplicate and invalid-date results. Do not replenish after
  a failed cycle result.
- Let replenishment errors reject the transaction. The existing per-client
  scheduler boundary logs the failure and retries on the next run.
- Keep current unique and overlap checks as the concurrency guard.

No scheduler change is needed: `initializeApp.ts` and
`createNextBillingCycle` already use this function.

### 3. Keep operational recovery and logging focused

- Log errors at the existing per-client scheduler boundary.
- If replenishment returns a summary, log only when rows changed.
- Keep **Fix all** as recovery for historical drift; normally advancing
  schedules should no longer need it.

## Behavioral test plan

Add a database-backed integration suite beside
`server/src/test/infrastructure/billing/invoices/clientBillingCycle.test.ts`,
for example `clientBillingCycleRecurringServicePeriods.test.ts`. Reuse
`TestContext`, freeze time, and query real cycle and service-period rows.
Do not add source-string wiring tests.

1. **Arrears advancement:** advancing to the 2026-08-01 to 2026-09-01 client
   cycle creates the missing 2026-07-01 to 2026-08-01 service period with that
   new cycle as its invoice window.
2. **Advance advancement:** the service period due at the newly opened window
   is materialized with the correct advance mapping.
3. **Idempotent repeated nightly runs:** a second automatic run at the same
   frozen time adds no cycles, rows, revisions, or superseded records.
4. **Multiple active lines:** one advancement replenishes every active
   client-cadence line without cross-obligation collisions.
5. **Billed-history preservation:** a seeded billed row keeps its identity,
   revision, dates, lifecycle state, and invoice linkage while future gaps are
   filled.
6. **Assignment boundaries and horizon:** no row precedes assignment start or
   extends past assignment end, and future coverage follows the shared horizon
   rather than stopping at one billing window.

Run the focused integration suite, existing client-cycle tests, existing
recurring-service-period regeneration/domain tests, and billing/shared
typechecks.

## Alternatives rejected

- **Tenant-wide repair after each tenant loop:** rescans every client, misses
  the manual boundary, and leaves cycle and ledger updates as separate
  outcomes.
- **A second recurring replenishment job:** introduces lag, ordering races, and
  duplicate retry/observability machinery.
- **Lazy repair during invoice generation:** is too late; the Generate screen
  and preflight logic must observe a complete canonical ledger.

## Risks and mitigations

- **Import layering:** verify the Nx dependency graph and typecheck; the billing
  package already imports the shared billing-client layer elsewhere.
- **Transaction duration:** keep work targeted to the current client's active
  lines and persist only deltas.
- **Race behavior:** preserve existing unique/overlap checks and duplicate
  results.
- **Historical rows:** never update billed rows in place; all changes flow
  through the canonical regeneration plan.

