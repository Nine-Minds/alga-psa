# Scratchpad — Billing Cycle Anchors (Day-of-Month) + Exclusive End Dates

- Plan slug: `billing-cycle-anchors`
- Created: `2026-01-09`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-01-09) Billing periods are treated as `[start, end)` (end exclusive) throughout billing, invoicing, and validation. Rationale: aligns with most query patterns already used in billing engine (e.g., `< endDate` filters) and avoids double-billing boundary events.
- (2026-01-09) Billing anchors are stored per-client in billing settings (not on `client_billing_cycles`), and only influence creation of *future* cycles. Rationale: `client_billing_cycles` is the concrete audit log of periods; anchors are configuration.
- (2026-01-09) V1 monthly day-of-month anchor supports **1–28 only** (no 29–31). Rationale: avoids short-month ambiguity.
- (2026-01-09) Quarterly/semi-annual/annual anchors include **start month selection** (plus day-of-month 1–28). Rationale: supports common anniversary/fiscal cycles.
- (2026-01-09) Bi-weekly anchor uses a concrete **first cycle start date** to establish stable parity. Rationale: simplest deterministic model.
- (2026-01-09) Anchor changes apply **after the last invoiced cycle** and may create a transition period to reach the next anchor boundary; transition periods require fixed-charge proration by period length.

## Discoveries / Constraints

- (2026-01-09) `BillingEngine.calculateBilling()` uses `client_billing_cycles.period_start_date` and `period_end_date` directly when present. This is the primary integration point for anchors (anchors only need to affect cycle generation). File: `server/src/lib/billing/billingEngine.ts:188`.
- (2026-01-09) Cycle generation currently hard-codes calendar boundaries for monthly+ in `getStartOfCurrentCycle()` (e.g., `startOfMonth`, `startOfYear`). File: `server/src/lib/billing/createBillingCycles.ts:141`.
- (2026-01-09) UI calls `createNextBillingCycle(clientId, selectedDate?.toISOString())`, but backend ignores the `effectiveDate` argument and always uses `{ manual: true }` with no effective date. Files: `server/src/components/billing-dashboard/BillingCycles.tsx:164`, `server/src/lib/actions/billingCycleActions.ts:116`, `server/src/lib/actions/billingCycleActions.ts:144`.
- (2026-01-09) Current cycle boundaries stored in DB appear to already be “end = next period start” (exclusive end) because `getNextCycleDate()` sets `period_end_date = effective + period`. File: `server/src/lib/billing/createBillingCycles.ts:191`.
- (2026-01-09) There is inconsistent end-date treatment inside billing engine: some logic uses end as exclusive, but `calculateInclusiveDays()` uses `+1` semantics, which can skew proration. File: `server/src/lib/billing/billingEngine.ts:2327`.
- (2026-01-09) Contract assignment overlap validation currently uses inclusive comparisons and should be updated to `[start, end)` to avoid false overlaps at boundaries. File: `server/src/lib/actions/client-actions/clientContractActions.ts:120`.
- (2026-01-09) Scheduled job runs nightly to create cycles for all clients/tenants. File: `server/src/lib/initializeApp.ts:307`.
- (2026-01-09) `client_billing_settings` has required (non-null) invoice/credit settings columns, so anchor updates must upsert/ensure a settings row exists (can’t blindly insert only anchor fields). File: `server/src/lib/actions/billingCycleAnchorActions.ts`.
- (2026-01-09) `createClientContractLineCycles` “manual” mode was effectively broken because it attempted to create the next cycle at the last cycle’s `effective_date` (duplicate) instead of starting from `period_end_date` (next boundary). File: `server/src/lib/billing/createBillingCycles.ts`.
- (2026-01-09) Transition-period proration is best modeled as `activeDays / canonicalCycleDays` (canonical cycle anchored at the next aligned boundary) so that non-canonical transition periods do not bill a full cycle amount. File: `server/src/lib/billing/billingEngine.ts`.
- (2026-01-09) Playwright UI clicks on the Billing Cycles table can be flaky because background server actions (e.g., notifications/metrics) can re-render the page between mouse down/up; in the anchor E2E test we trigger the button’s native `.click()` to avoid losing the click event.
- (2026-01-09) Knex may return timestamp columns as `Date` objects; using `String(date)` is locale/timezone-dependent and can break UTC-midnight validation. Normalize DB dates via `.toISOString()` before calling `ensureUtcMidnightIsoDate`. File: `server/src/lib/actions/billingCycleAnchorActions.ts`.
- (2026-01-09) The anchor editor UI uses constrained selects/inputs (e.g., monthly day-of-month 1–28), so “invalid anchor value” scenarios are not user-reachable via UI; validation messaging is best covered with unit tests for `validateAnchorSettingsForCycle`.

## Commands / Runbooks

- (2026-01-09) Find cycle generation logic: `rg -n "createClientContractLineCycles|getStartOfCurrentCycle|getNextCycleDate" server/src/lib/billing -S`
- (2026-01-09) Find end-date boundary usage: `rg -n "billingPeriod\\.endDate|calculateInclusiveDays|<\\s*billingPeriod\\.endDate" server/src/lib/billing/billingEngine.ts -S`

## Links / References

- Docs: `docs/billing/billing.md`, `docs/billing/billing_cycles.md`
- Cycle generation: `server/src/lib/billing/createBillingCycles.ts`
- Billing engine period usage: `server/src/lib/billing/billingEngine.ts`
- Billing cycle actions/UI: `server/src/lib/actions/billingCycleActions.ts`, `server/src/components/billing-dashboard/BillingCycles.tsx`

## Open Questions

- (2026-01-09) Do we need day-of-month 29–31 support in V1? If yes, how should short-month handling work (clamp vs roll-forward)?
- (2026-01-09) For quarterly/semi/annual: should anchor include start month selection, or keep existing calendar start months for V1?
- (2026-01-09) For bi-weekly: should anchor be “first cycle start date” (recommended) or “weekday + parity”?
