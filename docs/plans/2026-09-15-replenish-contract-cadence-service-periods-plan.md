# Replenish contract billing periods nightly and recover missing charges

**Card:** `dc81bd4f-79bb-4708-8b17-64fe682a1cba`
**Branch:** `feature/replenish-contract-billing-periods-nightly-and-r`
**Date:** 2026-09-15
**Plan provenance:** This is the Design Session review packet from workflow run
`05255b0a-78d6-4c53-a0e2-eb15718e53d4`, reproduced on the branch unedited. The
implementation spec is this packet, not a later rewrite.

---

# Design — nightly contract-cadence service-period replenishment (conn desk work)

## Problem (confirmed by code read)
The nightly billing-cycle job (`createClientContractLineCycles`, registered in `server/src/lib/initializeApp.ts` ~528) enumerates clients and, per billing profile, calls `replenishClientCadenceServicePeriods` (`shared/billingClients/clientCadenceScheduleRegeneration.ts:514`). **Nothing in the nightly path touches contract-cadence lines.** Contract-cadence rows are only materialised on authoring/repair via `syncRecurringServicePeriodsForContractLine` (`packages/billing/src/actions/recurringServicePeriodSync.ts:58`) → `materializeContractCadenceServicePeriodsForContractLine` (`packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts:518`). So once a contract-cadence line's finite schedule is exhausted, no nightly run extends it and due charges silently vanish from Ready to Bill.

## Second defect: the horizon is anchored to history, not today
`syncContractCadenceObligation` (`contractCadenceServicePeriodMaterialization.ts:395-494`) computes `regenerationStart = max(assignmentStart, billedBoundaryEnd)` and calls `materializeContractCadenceServicePeriods({ asOf: regenerationStart, … })`. That materializer derives `targetHorizonEnd = asOf + 180d` (`recurringServicePeriodGenerationHorizon.ts:47-73`). For a line idle for a long time, `regenerationStart` is far in the past, so `regenerationStart + 180d` can still be before today → the run generates only past periods and **never establishes future coverage**. Catch-up start and rolling target are conflated in one `asOf`.

## What changes, in order

1. **Decouple generation start from the horizon anchor** — `shared/billingClients/materializeContractCadenceServicePeriods.ts`
   - Add optional `coverageAnchorDate?: ISO8601String` to `MaterializeContractCadenceServicePeriodsInput`.
   - Horizon = `resolveRecurringServicePeriodGenerationHorizon({ asOf: coverageAnchorDate ?? asOf, … })`.
   - Generate with `rangeStart = asOf` (catch-up) and `rangeEnd = horizon.targetHorizonEnd` (rolling target).
   - `coverage` assessment uses `asOf: coverageAnchorDate ?? asOf` so `needsReplenishment` reflects today, not history.
   - Backwards compatible: callers that omit `coverageAnchorDate` behave exactly as today.

2. **Set the anchor and add a per-tenant replenisher** — `packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts`
   - In `syncContractCadenceObligation`: pass `coverageAnchorDate = maxIsoDateOnly(regenerationStart, todayUtcMidnight)`. Generation still starts at `regenerationStart`, so the CloudLab Aug 8–Sep 8 gap is backfilled, while the target reaches `today + 180d`.
   - Add `replenishContractCadenceServicePeriodsForTenant(trx, { tenant, asOf, sourceRunPrefix })` that enumerates eligible active contract-cadence lines (see 3) and calls the existing per-line sync. Reuse the canonical path; do not fork regeneration rules.
   - Guard long inactivity: cap generated periods per line (e.g. `MAX_PERIODS_PER_RUN`, order 200) and log when the cap is hit rather than silently truncating.

3. **Enumeration (tenant-scoped, no cross-tenant join)** — new query in the same module
   - `contract_lines` joined to `contracts` and the contract's client assignment, filtered to `cadence_owner='contract'`, line active, contract active/status active, assignment active with `start_date <= today` and (`end_date is null or end_date > today`).
   - Respect assignment bounds via the existing `clipRecurringCandidatesToObligationBounds` call (already in the sync path).

4. **Nightly wiring** — `server/src/lib/initializeApp.ts` (next to the existing billing-cycle registration)
   - Register a new recurring job `replenishContractCadenceServicePeriods`, scheduled every 24h, that enumerates tenants (same `tenantDb(...).unscoped('tenants')` pattern) and, per tenant, calls the tenant replenisher in one transaction per tenant.
   - **Independent of client cycle creation** (acceptance 1): it does not depend on `createClientContractLineCycles` or on a new `client_billing_cycles` row; contract anniversary anchors come only from `assignmentStart`.
   - Concurrency/idempotency: take a per-tenant Postgres advisory lock (`pg_advisory_xact_lock`) so overlapping pods/schedules serialise; the existing `backfillRecurringServicePeriods` plan is deterministic per `(scheduleKey, periodKey)` so a repeated run is a no-op.
   - Catch per-tenant and per-line errors so one bad tenant/line cannot abort the sweep; log tenant, line, and reason.

5. **Visibility (acceptance 8)** — emit a structured log/summary per tenant: lines examined, lines replenished, lines whose coverage still cannot reach the threshold (e.g. ended assignment), and any line that hit the period cap. This is the signal that replaces today's silent exhaustion.

## Preservation rules (must hold; acceptance 3, 6)
- Never touch `billed` or invoice-linked records; `loadExistingRecurringServicePeriodRecords` already excludes `archived|superseded|billed`, and `billedBoundaryEnd` is the catch-up floor.
- Never revive superseded historical client-cadence rows (the April 15 operator repair rows) — they are `superseded`/`archived` and stay excluded.
- **Locked periods must not be superseded.** Verify `backfillRecurringServicePeriods` skips locked records before relying on it; if it does not, add an explicit locked-period guard in the plan (fail closed, log).
- Manual overrides / skipped / deferred periods keep their lifecycle states; the backfill only supersedes `generated` rows.
- Client-cadence replenishment, billing profiles, and mixed-cadence behaviour are untouched; the new pass writes only `contract` cadence rows.

## Explicitly NOT doing
- No invoice creation or sending — the pass writes service periods only.
- No one-off tenant repair / data migration for CloudLab; the fix must self-heal on the next successful run (acceptance 2).
- No change to client-cadence replenishment or billing-profile passes.
- No re-anchoring contract periods to client calendar months.

## Risks / to verify in implementation
- Whether `backfillRecurringServicePeriods` preserves locked records (drives whether a guard is needed).
- Citus: all queries tenant-scoped via `tenantDb`; no cross-tenant joins; one transaction per tenant.
- The CloudLab `assignment.status='pending'` oddity is not the blocker (it has billed repeatedly) — do not gate enumeration on assignment status alone.
- Live evidence was gathered from a read-only production pod; exact deployed source/image equivalence and nightly history were not verified — confirm current main wiring.

## Tests (acceptance 9, DB-backed; no source-string/import tests)
Frozen-time CloudLab reproduction (missing Aug 8–Sep 8 created, mapped to the Sep 8–Oct 8 invoice window); next-run catch-up after scheduler downtime; repeat/concurrent idempotency (no duplicates); moving horizon with no invoices generated; preserved billed/locked/override/superseded rows; advance and arrears month-end anniversaries; inactive/ended assignments produce no new rows; mixed client+contract cadence and multi-profile no-duplication; scheduler failure recovery (per-tenant isolation).

## Verification / rollout (acceptance 7)
Read-only audit query for contract-cadence coverage across all tenants (pre-deploy); after deploy, verify CloudLab gains Aug 8–Sep 8 and future periods and appears in Ready to Bill.

---

## Specification reconciliation (2026-09-16)

A second, untracked packet — `ee/docs/plans/2026-09-16-contract-cadence-service-period-replenishment/`
(PRD, SCRATCHPAD, features, tests) — was written after this committed packet. It
proposes a different execution architecture and is **not** the implemented
specification. The two were not combined.

**Committed packet wins (implemented):**

- A dedicated nightly `replenishContractCadenceServicePeriods` sweep, separate
  from `createClientContractLineCycles`, with per-tenant transactions and a
  `pg_advisory_xact_lock`, reusing the canonical contract sync so regeneration
  rules are not forked.
- `coverageAnchorDate` decouples the generation start from the rolling horizon.

**Competing packet (rejected, not implemented):**

- Hooking replenishment into the per-client `createClientContractLineCycles`
  boundary and adding a `clientId` filter, so the sweep would depend on client
  cycle creation and run once per client visit.
- Consolidating the two `createClientContractLineCycles` implementations
  (`packages/billing` → `shared/billingClients`). This is a distinct refactor
  with its own blast radius; it is out of scope here.
- `SELECT … FOR UPDATE` row locking on eligible contract lines in place of the
  per-tenant advisory lock.

**Useful acceptance coverage carried over from the untracked packet:** tenant
isolation and per-line/per-tenant failure isolation, cap visibility and
continuation, skipped/deferred/stale-row preservation, advance/arrears and
month-end anchors, mixed client/contract cadence, and the read-only audit. The
competing packet's identifier-free artifacts remain in the working tree
uncommitted; their identifiers stay on the board card.

**Overriding human requirement:** Essentials and Pro run the sweep on the
established Temporal maintenance fan-out
(`maintenance-fanout:replenishContractCadenceServicePeriods`, daily at 04:00
UTC), with the pg-boss recurring schedule used only where Temporal is not the
scheduling authority. The commit-time draft's pg-boss-only wiring did not
satisfy this and has been corrected.
