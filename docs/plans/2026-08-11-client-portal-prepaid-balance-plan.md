# Client Portal: Prepaid Balance & Hours Visibility — Implementation Plan

**Card:** 29.8.21 (release v1.5) · **Branch:** `feature/client-portal-prepaid-balance`
**Date:** 2026-08-11

## Goal

Surface prepaid state in the client portal so prepaid stops being a black box:

1. **Credit balance with recent issuance/application history** — the client can see not
   just the balance but where credit came from and where it went.
2. **Bucket hours meters** — used / remaining / rollover per contract line, with the
   service period they cover.
3. **Discoverability** — an hours-remaining widget on the portal dashboard (the landing
   page), so clients see prepaid state without digging into More → Billing.

Read-only throughout. No new tenant-level setting: visibility follows the existing
client-portal billing gates (`hasBillingAccess` for nav/pages, per-action billing read
permission server-side).

## Current state (verified live + in code)

The portal Billing area (`/client-portal/billing`, `packages/client-portal/src/components/billing/`)
already has:

- `CreditsSummaryCard.tsx` — headline available credit (via `getClientCreditSummary`)
  plus up to 3 active credits with remaining amount and expiry badge. **No history.**
- `BucketUsageChart.tsx` rendered per bucket row on `BillingOverviewTab.tsx` — % used,
  hours used / hours total, a note when rollover hours are included. **No first-class
  remaining number, no period dates.**
- `Hours by Service` and `Usage Metrics` tabs (date-ranged, unaffected by this card).

The portal dashboard (`ClientDashboard.tsx`) has no billing/prepaid presence.

The feature flag `release-v1-5-feature` appears nowhere in the repo yet; this card
introduces the first portal-side flag check.

## Feature flag gating (standing release requirement)

Every UI change below is gated behind `release-v1-5-feature` via
`useFeatureFlag('release-v1-5-feature', { defaultValue: false })`
(`packages/ui/src/hooks/useFeatureFlag.tsx`; PostHog provider is mounted in the root
layout so portal routes are covered). Flag off ⇒ the rendered UI is exactly today's:
no history affordance, unchanged bucket meter, no dashboard widget. While the flag
state is loading, render the flag-off UI (never flash the new surfaces).

The server-side permission hardening in item 4 is not UI and ships ungated.

## Work items

### 1. Portal server action: credit history

In `packages/client-portal/src/actions/client-portal-actions/client-billing.ts` add
`getClientCreditHistory()`:

- Resolve the caller's client via `getClientIdFromPortalUser()` and gate with
  `hasClientBillingReadPermission()` (same pattern as `getClientCreditSummary`).
- Query `transactions` scoped to tenant + client,
  `whereIn('type', ['credit_issuance', 'prepayment', 'credit_application',
  'credit_adjustment', 'credit_expiration', 'credit_transfer',
  'credit_issuance_from_negative_invoice'])`, newest first, limit 20.
- Left-join `invoices` to carry `invoice_number` for application entries (mirror the
  MSP `getCreditHistory` in `packages/billing/src/actions/creditActions.ts:1045`, which
  cannot be reused directly — it runs under MSP `withAuth` + `credit:read` permission).
- Return a typed row: `{ transaction_id, type, description, amount, balance_after,
  created_at, invoice_id, invoice_number, currency_code }`.

Do NOT expose MSP-internal fields (metadata, parent/related transaction ids).

### 2. Credit history UI (lightweight)

**Chosen presentation (mockup options 1A + 2A):** the card itself is unchanged except
for one new "View history" link; the history opens in a Dialog rendered as a **ledger**.

`CreditsSummaryCard.tsx`: when the flag is on, add the "View history" link below the
credit list. It opens a Dialog (follow `InvoiceDetailsDialog.tsx` conventions) listing
the recent entries, one ledger row each:

- left: friendly type label (Issued — prepayment #INV-N / Applied to invoice #N /
  Adjusted / Expired / Transferred) over the date;
- right: signed amount (credits green `+`, debits plain `−`) over a muted
  "balance $X.XX" line derived from the transaction's `balance_after`.

Loading skeleton, empty state ("No credit activity yet"), and error state degrade
gracefully (dialog shows empty state; card behavior unchanged).

Friendly type labels and all new strings go under `credits.history.*` in
`server/public/locales/<locale>/features/billing.json` for **all** locales
(de, en, es, fr, it, nl, pl, pt, xx, yy) — translation quality checks are enforced
in CI.

### 3. Bucket meter upgrade (Billing overview)

**Chosen presentation (mockup option 3B — remaining-first):** `BucketUsageChart.tsx`
(portal copy), flag on only, restructures each meter as:

- Header row: line/service name on the left, the covering period as a small chip on
  the right (`period_start` – `period_end`).
- **Headline: remaining hours** — "7.0 hours left of 22.0 (incl. 2.0 rollover)".
  Semantics must mirror `getRemainingBucketUnits`
  (`packages/reporting/src/actions/report-actions/getRemainingBucketUnits.ts`):
  `remaining = total_minutes + rolled_over_minutes − minutes_used`.
- The existing progress bar stays below the headline as context, footed by
  "used / left" figures.
- **Overage state:** when remaining < 0, the headline turns red and reads
  "0.5 hours over" with an "OVER BUCKET" badge, and the bar shows the overage as a red
  segment — never render a negative remaining number.
- No segmented rollover visualization (rejected option 3C): the billing engine does not
  track a rollover-vs-base draw order, so the bar must not imply one.

Flag off ⇒ the current layout (% headline, used/total, rollover footnote) renders
byte-identical.

`getClientBucketUsage` (`client-billing-metrics.ts:405`) already returns every needed
field; no query changes.

### 4. Server-side permission hardening (ungated)

`packages/client-portal/src/actions/client-portal-actions/client-billing-metrics.ts`
actions (`getClientBucketUsage`, `getClientBucketUsageHistory`, `getClientHoursByService`,
`getClientUsageMetrics`) currently skip the billing read permission that
`getClientCreditSummary` enforces. Add `hasClientBillingReadPermission()` to each,
returning the actions' existing error shape. The only existing callers sit behind the
billing nav gate (`hasBillingAccess`), so no visible behavior changes for legitimate
users; direct invocation without the permission now fails closed.

### 5. Dashboard hours-remaining widget

`ClientDashboard.tsx` (`packages/client-portal/src/components/dashboard/`), flag on only:

- **Chosen presentation (mockup option 4A):** a compact "Prepaid hours" card in the
  existing card grid below the KPI row: header row with the card label and a
  "View billing →" link to `/client-portal/billing`; then one row per bucket line —
  line/service label on the left, bold "7.0h left" on the right (or a red "0.5h OVER"
  badge in overage), with a slim mini progress bar underneath (reuse the meter color
  logic from item 3). No KPI-tile summing across lines (rejected option 4B — bucket
  lines are not interchangeable, a summed number misleads).
- Render only when ALL hold: flag on, the user's portal permissions include billing
  access (`checkClientPortalPermissions().hasBillingAccess` — plumb through the same
  path the sidebar uses), and `getClientBucketUsage()` returns ≥ 1 row. Otherwise
  render nothing — the dashboard looks exactly as today.
- A permission error from the action (post-item-4) counts as "render nothing".

### 6. Tests

- **Action tests** for `getClientCreditHistory`: tenant + client scoping, permission
  gate (denied → error shape, not a throw), type filtering (a `payment` or
  `invoice_generated` row never appears), ordering and limit.
- **Permission tests** for item 4: each metrics action fails closed without billing read.
- **Component/contract tests** (follow `ClientDashboard.contract.test.ts` pattern):
  - Credit card: flag off ⇒ no history affordance; flag on ⇒ affordance renders,
    dialog lists rows, empty state.
  - Bucket meter: flag off ⇒ no remaining/period line; flag on ⇒ remaining math
    matches the `getRemainingBucketUnits` formula, overage renders "over" not negative.
  - Dashboard: flag off / no permission / no buckets ⇒ widget absent; all three met ⇒
    widget renders.
- Typecheck + existing test suites stay green.

## Explicitly out of scope

- **Usage Metrics history bug**: the existing "Hours Usage History" chart renders
  impossible values against dirty data (observed live: 2513% usage on a 2-hour bucket).
  Pre-existing, in a seam this card doesn't touch (`getClientBucketUsageHistory`
  consumers). Flag for a separate card.
- Per-tenant prepaid-visibility toggle in `clientPortalFeatureSettings` (decided
  against; revisit only if an MSP asks).
- A dedicated "Credits" tab / full-page history (lightweight dialog chosen instead).
- The hardcoded `SHOW_USAGE_FEATURES = true` in `BillingOverview.tsx` (leave as is).

## Verification plan (for the Implement/Smoke steps)

1. Flag off (default): portal Billing overview and Dashboard pixel-identical to main.
2. Flag on, client with credits + bucket lines: history dialog shows issuance and
   application entries with invoice numbers; meters show remaining + period; dashboard
   widget lists each bucket line.
3. Flag on, user without billing access: no dashboard widget; Billing hidden from nav
   (existing behavior); metrics actions fail closed when invoked directly.
4. Flag on, client with no bucket lines: no dashboard widget; overview shows credit
   card only.

Dev-stack note: seeding credit history locally requires credit transactions
(`credit_issuance` / `prepayment` / `credit_application`) — the current local dataset
has none; create them via the MSP Prepayment Invoices flow or targeted inserts during
smoke testing.
