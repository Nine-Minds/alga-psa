# Wizard Review total: show the amount in the cadence the contract bills

Card: `21bf9da9` · PSA ticket `alga-2026-0002714` (`84feb4ad-04f1-4040-8565-1ee8703220c4`) · branch
`feature/wizard-review-total-shows-annual-contracts-only`

## Problem

The contract wizard's Review step prints one headline: **"Estimated Monthly Total"** with the suffix
**"per month"**. The number is arithmetically correct, but for an annual contract it is not the amount
the customer invoices. Lynda (CloudVBS) built an annual Licensing contract — 4 × M365 Business Premium
(A$160.98), 4 × Defender Suite (A$180.00), 4 × Cloud Backup (A$90.00) — which bills **A$1,723.92 a
year**, and the Review page told her **A$143.66 per month**. Annual licensing is the normal MSP case,
so this reads as a wrong total on the last screen before the contract is created.

## What the code actually does today

`packages/billing/src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep.tsx`

- `calculateTotalMonthly()` (line ~239) sums three things, each already normalized to **monthly**:
  `fixedLinesRecurringTotalCents(...)`, `cadencePrepaidBlocksMonthlyCents(...)`, and
  `resolveFixedLineRecurringTotal(...)` for the product lines.
- The total card (lines ~938-970) hardcodes the i18n defaults `wizardReview.total.title`
  ("Estimated Monthly Total") and `wizardReview.total.perMonth` ("per month"), and prints
  `formatMinorCurrency(calculateTotalMonthly())`. `data.recurring_baseline.monthly_cents` (the saved
  draft value) is monthly too.

`shared/billingClients/recurringMemberRate.ts` already exposes both halves of what is needed:

- `resolveFixedLinePeriodTotal(line)` → un-normalized amount for **one billing period** of the line.
- `resolveFixedLineRecurringTotal(line, frequency)` → `normalizeToMonthlyCents(period, line.billing_frequency ?? frequency)`.
- `normalizeToMonthlyCents(cents, frequency)` → the single cadence rule (weekly ×4.33, quarterly ÷3,
  semi-annually ÷6, annually ÷12, otherwise monthly).

So the information is present; **only the aggregation throws the cadence away**. That is the defect:
the wizard asks the resolver for a monthly scalar and then labels the result with a presentation string.

## Direction

Fold the cadence into the shared value type rather than into the component's arithmetic. The wizard,
the stored contract value and the invoice engine must keep agreeing (see #3836), so the cadence
grouping belongs next to `normalizeToMonthlyCents`, not in the Review step.

### Layer 1 — shared resolver: a recurring summary type

In `shared/billingClients/recurringMemberRate.ts`:

```ts
export interface RecurringPeriodAmount {
  /** Amount for one billing period, in minor units. */
  periodCents: number;
  /** The cadence that amount is billed on. */
  frequency: string | null | undefined;
}

export interface RecurringFrequencyGroup {
  frequency: string;        // canonical, as stored ('monthly' | 'annually' | …)
  periodCents: number;      // sum of the group's per-period amounts
  monthlyCents: number;     // normalizeToMonthlyCents(periodCents, frequency)
}

export interface RecurringSummary {
  groups: RecurringFrequencyGroup[];  // stable order, largest monthlyCents first
  /** Sum of every group's per-period amount *only when all groups share one frequency*; else null. */
  singleFrequencyPeriodCents: number | null;
  singleFrequency: string | null;
  /** Σ group.monthlyCents — the comparable figure, and what the stored value keeps using. */
  monthlyCents: number;
}

export function summarizeRecurringAmounts(amounts: ReadonlyArray<RecurringPeriodAmount>): RecurringSummary;
```

Rules, each one derived from the existing rule and not re-implemented:

1. A group's `monthlyCents` is `normalizeToMonthlyCents(periodCents, frequency)` — grouping first, then
   normalizing, because normalizing per line and summing can drift by a cent on weekly cadences
   (`Math.round` per line vs per group). The monthly figure therefore changes by at most rounding drift;
   tests pin whichever the invoice engine already produces for a single-frequency contract so the three
   surfaces cannot disagree.
2. `null`/unknown cadence is treated as `monthly` (the storage default) for grouping purposes, so old
   cards do not produce a "null per month" row.
3. Groups with `periodCents === 0` are dropped.
4. `singleFrequency*` is non-null only when every group has the same canonical frequency — that is the
   common case (one contract cadence), and it is what the headline shows.

### Layer 2 — wizard Review step

`ReviewContractStep.tsx` builds `RecurringPeriodAmount[]` instead of a single monthly number:

- each Fixed/Products line: `resolveFixedLinePeriodTotal(line)` with `line.billing_frequency ?? data.billing_frequency`;
- each prepaid block draft: its period fee on `data.hourly_billing_frequency ?? data.billing_frequency`;
- then `summarizeRecurringAmounts(...)`.

Rendering:

- **One frequency** (the common case): headline is `formatMinorCurrency(singleFrequencyPeriodCents)` with
  the suffix from `formatBillingFrequency(singleFrequency)` ("per year", "per month", …). Underneath, one
  secondary line: "about A$143.66 a month" — the comparable figure — only when the frequency is not monthly.
- **Mixed frequencies**: the card lists one row per frequency ("A$1,723.92 per year", "A$450.00 per month"),
  then the monthly-equivalent line as the total.
- "Saved draft value" stays `recurring_baseline.monthly_cents` and keeps saying **per month** — it is a
  stored monthly value; it must not be relabelled with the contract cadence.

New i18n keys (`wizardReview.total.perFrequency`, `.perMonthEquivalent`, `.mixedFrequencyTitle`) must be
added to **every** locale pack in the same commit — the locale and `artifact-drift` CI checks fail a
half-translated key set, and that is the most common red on this card family. Reuse `formatBillingFrequency`
and `formatMinorCurrency`; no hardcoded currency (contract currency only) and no new formatter.

### Layer 3 — tests

- `shared/billingClients` unit tests for `summarizeRecurringAmounts`: single annual, single monthly,
  mixed monthly+annual, weekly rounding, null cadence → monthly, zero-amount group dropped, and the
  single-frequency monthly total equals `resolveFixedLineRecurringTotal` for the same lines.
- A Review-step test: an all-annual contract shows the annual amount as the headline with "per year" and
  the monthly equivalent as the secondary line; a mixed contract renders one row per frequency; the
  saved-draft line still reads "per month".

## Deliberately not doing

- **Not changing what is stored.** `recurring_baseline.monthly_cents` and the contract's recurring value
  stay monthly — the invoice engine and reporting read them today and #3836 depends on it. The change is
  presentation plus one shared aggregation helper.
- No invoice-engine change and no new "annual total" column on the contract.
- No redesign of the Review step's other cards, and no currency picker (the contract currency governs).
- No client-side re-derivation of the rate chain: product rates still come from `resolveFixedLineRecurringTotal`
  and `resumedCatalogRates`, exactly as now.

## Risks

- **Rounding drift**: moving from "normalize each line, sum" to "sum the period, normalize the group" can
  shift a weekly total by a cent. Mitigation: the single-frequency monthly total must still equal the
  existing resolver's value for the same lines (unit test), and if it cannot, normalize per line and sum
  for `monthlyCents` while keeping groups per-period — decide in implementation, but never let the stored
  value and the invoice disagree.
- **Per-line frequency override**: a line whose own `billing_frequency` differs from the contract's must
  group under its own frequency; the description's "mixed frequencies" case is exactly this.
- **Prepaid blocks** are billed in advance on the hourly frequency; if a contract has both a prepaid block
  and annual products, the wizard will legitimately show two rows. That is correct, not a bug.
- **Locale packs**: forgetting one fails CI; the plan puts it in the same commit on purpose.

## Order of work

1. Shared resolver + unit tests (no UI risk, and it pins the numbers).
2. Review step rendering + i18n keys in every pack.
3. Component test, then `nx affected -t typecheck test build` for billing and shared.

## Decisions taken in implementation

- **Monthly equivalent is normalized per line, then summed** (the Risks section's fallback). Groups carry
  the summed per-period amount; `monthlyCents` is `Σ normalizeToMonthlyCents(entry)`. That is the rule
  `contractMonthlyValue` and the engine already apply, so the wizard figure cannot drift from the stored
  value by a weekly rounding cent. A unit test pins it against `resolveFixedLineRecurringTotal`.
- **One cadence table.** `canonicalRecurringFrequency` (shared) is the single reader of stored cadence
  spellings (`semi_annually` → `semi-annually`, null/unknown → `monthly`); `normalizeToMonthlyCents` now
  switches on it instead of keeping its own copy of the cases.
- **The "per year" suffix lives in the billing enum layer, not the wizard.** `formatBillingFrequency`
  returns the adjective ("Annually"), which cannot follow an amount. `useFormatBillingPeriod` sits next to
  it in `useBillingEnumOptions`, keyed by the canonical cadence, with English defaults in
  `BILLING_PERIOD_LABEL_DEFAULTS` and translations under `features/billing` `enums.billingPeriod.*`. The
  monthly headline uses the same formatter, so `wizardReview.total.perMonth` is retired.
- **Saved draft value says "per month" on its own** whenever the headline is not monthly
  (`wizardReview.total.savedDraftValueMonthly`); under a monthly headline it reads as before.
- **Contracts list and contract Overview stay monthly here — follow-up.** Both read
  `contractMonthlyValue`, which is a stored monthly figure that reporting and renewal generation also
  consume. Giving them per-period presentation means carrying per-line period amounts and cadence through
  that read model, not relabelling a scalar; that is its own change. `summarizeRecurringAmounts` and
  `useFormatBillingPeriod` are the pieces it will reuse.
