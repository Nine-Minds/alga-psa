# PRD — Billing Cycle Anchors (Day-of-Month) + Exclusive End Dates

- Slug: `billing-cycle-anchors`
- Date: `2026-01-09`
- Status: Draft

## Summary
Add per-client **billing cycle anchors** so MSPs can invoice clients on non-calendar boundaries (e.g., “bill on the 10th of each month”), while standardizing the billing domain on a single, consistent date-range convention: **billing period end dates are exclusive**.

## Problem
Today Alga supports picking a billing cycle type per client (weekly/bi-weekly/monthly/quarterly/semi-annually/annually), but cycle generation is effectively aligned to calendar boundaries for monthly+ (and has inconsistent logic for weekly/bi-weekly), and the billing domain has mixed semantics for whether a period end date is inclusive or exclusive. This prevents common MSP workflows like:

- “Invoice this client monthly on the 10th.”
- “Invoice this client annually on their service anniversary.”
- “Invoice this client every 2 weeks starting next Friday.”

## Goals
- Allow admins to configure a **per-client billing cycle anchor** appropriate to the client’s billing frequency.
- Ensure billing, proration, and overlap validation all treat billing periods as **`[start, end)`** (end is exclusive).
- Ensure the design works across cycle types: `weekly`, `bi-weekly`, `monthly`, `quarterly`, `semi-annually`, `annually`.
- Preserve existing behavior by default (clients without anchors keep the current “calendar-aligned” schedule for monthly+/annual and the current rolling schedule for weekly/bi-weekly).

## Non-goals
- Replacing `client_billing_cycles` with a new “bill run” system; we continue to use `client_billing_cycles` as the source of truth for concrete billing periods.
- Retroactively rewriting already-invoiced billing periods.
- Supporting arbitrary time-of-day boundaries; billing periods remain **UTC-midnight dates**.
- V1: complex “29/30/31st of month” semantics unless explicitly requested (see Open Questions).

## Users and Primary Flows
### Personas
- **Billing Admin (MSP):** configures billing cycles and anchors per client; generates invoices.
- **Ops/Admin:** adjusts client billing settings during onboarding/renewal.

### Primary flows
1. Billing admin selects a client from the Clients menu.
2. In the client detail view, navigates to the client’s **Billing** tab.
3. Chooses the billing cycle type and configures the anchor (cycle-type-aware).
4. System uses the configured schedule to generate upcoming billing cycles (automated nightly + manual “create next cycle”).
5. Billing admin generates invoices from billing cycles (existing).

Secondary flow:
- Billing admin opens Billing → Billing Cycles to review a cross-client summary and click through to a specific client’s Billing tab.

## UX / UI Notes
**UI placement**
- Billing schedule configuration (cycle type + anchor + preview) lives on the **Client → Billing** tab.
- The Billing → Billing Cycles tab is **summary-only** (no schedule editing); it links to the client’s Billing tab for changes.

**Anchor UX** should be cycle-type aware:

- **Weekly:** choose “weekday” (Mon–Sun). Optionally show the computed “next start date” preview.
- **Bi-weekly:** choose a concrete “first cycle start date” (UTC date) so parity is stable.
- **Monthly:** choose “day of month” (default 1). V1 is limited to **1–28** for predictability.
- **Quarterly:** choose “start month” + day-of-month (1–28), with a preview of next cycle boundaries.
- **Semi-annually:** choose “start month” + day-of-month (1–28), with a preview of next cycle boundaries.
- **Annually:** choose “start month” + day-of-month (1–28), with a preview of next cycle boundaries.

UI should make the date semantics explicit in copy/tooltips: “Billing periods are `[start, end)`; end date is the start of the next period.”

## Requirements

### Functional Requirements
**Billing schedule configuration (cycle type + anchor)**
- Store a per-client anchor configuration.
- Validate anchor values (ranges, required fields per cycle type).
- Use anchor configuration when generating *new* `client_billing_cycles` rows.
- Allow updating schedule configuration (cycle type and/or anchor), with guardrails to avoid breaking already-invoiced periods.

**Cycle generation**
- Initial cycle creation uses anchor logic to pick the correct current cycle start.
- Subsequent cycle creation advances deterministically by cycle type from the last cycle’s boundary.
- Manual “Create Next Cycle” uses the same logic as the scheduled job and respects anchor configuration.
- Schedule updates (cycle type and/or anchor) take effect **after the last invoiced cycle**:
  - Compute `cutoverStart = lastInvoiced.period_end_date` (exclusive end = next start).
  - Create a *transition period* `[cutoverStart, nextAnchorBoundary)` (if `cutoverStart` is not already aligned).
  - Create subsequent full periods aligned to the configured anchor.
- Transition periods require deterministic proration of fixed recurring charges based on actual period length vs canonical cycle length.

**Exclusive end date consistency**
- All billing periods are treated as **`[period_start_date, period_end_date)`**.
- Proration factors and “days in period” calculations must be consistent with exclusive end semantics.
- Overlap detection and “cannot span cycle change” validation must use exclusive end semantics.

### Non-functional Requirements
- Deterministic and timezone-safe: all persisted billing boundary dates are UTC-midnight ISO8601 strings.
- Backward compatible: existing clients with no anchor configured continue behaving as today.

## Data / API / Integrations
### Data model
Add anchor fields to `client_billing_settings` (preferred, since it already stores billing knobs) rather than adding new columns to `clients` or `client_billing_cycles`.

Proposed shape (final schema is a design decision in implementation):
- `client_billing_settings.billing_cycle_anchor_day_of_month` (int, nullable)
- `client_billing_settings.billing_cycle_anchor_month_of_year` (int, nullable; for annual/semi/quarterly where applicable)
- `client_billing_settings.billing_cycle_anchor_day_of_week` (int, nullable; ISO 1=Mon..7=Sun)
- `client_billing_settings.billing_cycle_anchor_reference_date` (date/timestamp UTC-midnight, nullable; for bi-weekly parity / “first cycle start”)

### API / server actions
- Add server actions for reading/updating the anchor configuration.
- Add a server action for updating a client’s billing schedule (cycle type + anchor) that applies the same cutover behavior as anchor updates.
- Ensure invoice generation continues to rely on `client_billing_cycles.period_start_date/period_end_date` (no anchor logic in invoice generation).

## Security / Permissions
- Same permissions as existing billing configuration: only tenant users with billing/admin privileges can update anchors and create cycles.

## Observability
- Not in scope for V1 (no new dashboards/metrics); rely on existing logs and error surfaces.

## Rollout / Migration
1. Ship schema changes for anchor fields on `client_billing_settings`.
2. Backfill default anchor values for existing clients:
   - monthly/quarterly/semi/annually: default day-of-month = 1, default start-month = current calendar convention (Jan/Apr/Jul/Oct; Jan/Jul; Jan).
   - weekly/bi-weekly: preserve current rolling behavior unless the admin sets an anchor.
3. Update cycle generation to use anchor settings for newly created cycles.
4. Update date-range semantics and fix inconsistent end-date usage.
5. Document the semantics and migration notes in billing docs.

## Open Questions
1. For weekly: do we also want a “first cycle start date” option (like bi-weekly) to make weekday-only anchors less ambiguous for initial creation?
2. When changing schedule (cycle type and/or anchor), should the UI show an explicit warning that future non-invoiced billing cycles will be regenerated under the new schedule?

## Acceptance Criteria (Definition of Done)
- A billing admin can set a monthly anchor day (e.g., 10) for a client and the system generates monthly billing cycles starting/ending on the 10th.
- Weekly, bi-weekly, quarterly, semi-annual, and annual cycle generation continues to work and respects anchors when configured.
- Billing, proration, and overlap validation treat billing periods as `[start, end)` with end exclusive.
- Manual “Create Next Cycle” respects anchor configuration and no longer ignores provided anchor/effective date inputs.
- Billing cycle type changes follow the same cutover behavior as anchor changes (no retroactive modification of invoiced cycles; future non-invoiced cycles are regenerated under the new schedule).
- Existing clients without anchors are not behaviorally broken; already-invoiced cycles are not modified.
