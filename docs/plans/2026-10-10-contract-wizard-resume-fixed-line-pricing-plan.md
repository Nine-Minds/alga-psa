# Plan — Contract wizard Resume keeps every fixed line (alga0002269)

PSA ticket alga0002269 (Critical). Board card `cfe7ef30`. Branch
`feature/alga0002269-contract-wizard-resume-loses-fixed-l`, cut from `main` at `b0d0b4dacf`.
Related: alga0002267 ("Set to Active" does nothing), alga0002268 (23503 on finalize, fixed in
`628112e8a5`).

## 1. The defect, as it stands on `main`

The wizard holds **one** fixed line: `fixed_services[]` plus a single `fixed_base_rate`,
`fixed_billing_frequency` and `enable_proration`. Finish Setup and Save Draft both send an
existing draft through `createClientContractFromWizard` with `contract_id`. That call runs
`clearExistingContractData`, which deletes every line, and then rebuilds one line per kind
(`contractWizardActions.ts:960-1035`, `:1284-1410`). Anything the wizard could not hold is
gone after the rebuild.

Facts checked against the current code:

| # | Path | What happens |
|---|------|--------------|
| 1 | `getDraftContractForResume` (`contractWizardActions.ts:2086`) | All non-product members of every `Fixed` line go into one `fixed_services` array. `fixedBaseRateCents` is overwritten for each such line (`:2220-2226`), so the **last line's rate wins**. Proration and frequency are also last-wins. |
| 2 | Finalize (`:1288-1407`) | One `Fixed` line is rebuilt, and `allocateBundleBaseRate` spreads that single surviving rate across **every** bundle member from every original line. Two bundle lines at $3,000 and $1,050 come back as one line worth $1,050. |
| 3 | Quote conversion (`quoteConversionService.ts:690-760`) | A recurring quote item with no `service_id` becomes a `Fixed` `contract_lines` row with `custom_rate`, but **no** `contract_line_services` or configuration rows. Resume reads nothing from it, and finalize deletes it. |
| 4 | Quote preview (`quoteConversionService.ts:590`) | The exclusion reason "Recurring items must reference a catalog service before contract conversion" can never fire. `getSelectedRecurringItems` does not filter on `service_id`, so service-less items are listed as contract items. The rule was meant to exist but never runs. |
| 5 | Billing engine (`computeFixedCharges.ts:808-834`) | A `Fixed` line with a positive rate and no members bills nothing and raises the `FIXED_LINE_NO_SERVICES` blocker. A service-less custom line was **already unbillable** before resume touched it. Meanwhile `contractMonthlyValue.ts:431` still counts its `custom_rate` in "Est. Monthly Value". |
| 6 | Quote conversion, bundle rows (`:707`, `:739`, `:766`) | A bundle-priced item (a fractional quantity, or a custom item) writes the line `custom_rate = item.unit_price`, not the item total. The engine bills the line rate once (`computeFixedCharges.ts:218-251`). A 2.5 × $100 item therefore bills $100, not $250. This is a separate under-billing defect on the same path (see §3.6). |
| 7 | Template snapshot (`getContractTemplateSnapshotForClientWizard`, `:1811`) | Same last-wins collapse of `fixedBaseRateCents` (`:1940`) for templates that have more than one fixed line. |
| 8 | EE draft simulator (`draftContractToScenario.ts:146`, `ContractDraftSimulationInput`) | Reads the same single-line shape, so the simulation shows the collapsed contract. |

Note: there is no `contract_line_fixed_config` table any more. Migration
`20251028120000_consolidate_contract_line_rates` merged it into `contract_lines`, so a line's
bundle base rate **is** `contract_lines.custom_rate`. The `ContractLineFixedConfig` model maps
`base_rate` to `custom_rate`.

## 2. Key decisions

1. **Round-trip, don't refuse.** The wizard holds a list of fixed lines (`fixed_lines[]`). Each
   line carries its own bundle base rate, members, frequency, timing, proration, name,
   description and `location_id`. Multi-line fixed contracts are a normal shape: quote
   conversion produces one line per item, and the contract detail editor can add lines. A wizard
   that cannot represent them is the defect.
2. **One shared fixed-line type.** The fixed-service shape is currently copied in five places:
   `ContractWizardData`, `DraftContractWizardData`, `ClientContractWizardSubmission`,
   `ClientTemplateSnapshot` and `ContractDraftSimulationInput`. It becomes a single
   `ContractWizardFixedLine` type in `@alga-psa/types`, and every one of those five uses it.
3. **Resume still refuses what it cannot represent.** Some shapes still have no wizard
   representation: a `Fixed` line mixing product and service members, or hourly/usage lines that
   differ in frequency, location or timing. A **round-trip fidelity check** catches these. It
   normalizes the stored lines and the resumed wizard data into one canonical recurring shape and
   compares the two. If they differ, Resume returns an itemized `actionError` naming the lines,
   and the UI shows it as a toast. Because the check is generic, the next unrepresentable shape
   is refused without anyone hand-adding a case.
4. **Service-less fixed lines round-trip but cannot be finished.** They resume as a fixed line
   with a base rate and no services. Save Draft stores them as they are. Finish Setup refuses
   them in step validation and on the server with "Fixed line "X" has a recurring amount but no
   service to bill it on — add a service before finishing". This mirrors the engine's
   `FIXED_LINE_NO_SERVICES` blocker, so the line is fixed before it can be activated rather than
   discovered at invoicing.
5. **Quote conversion stops creating service-less recurring lines.** The preview reports such
   items as blocking and drops `contract`/`both` from `available_actions`.
   `convertQuoteToDraftContract` throws the same message (fail-fast). This turns the dead
   exclusion in row 4 into a working rule. Excluding the item silently would drop revenue, so
   the item blocks conversion instead.
6. **The finalize guard is the server's total, and the user must confirm a change to it.**
   Inside the transaction, for any existing draft (both Finish Setup and Save Draft):
   - `before` = `getContractMonthlyFixedValuesByContract(trx, …)` before the clear.
   - `after` = the same function after the rebuild.
   - If `before ≠ after` and the submission does not carry
     `recurring_change_ack.baseline_monthly_cents === before`, the transaction rolls back. The
     action then returns `{ confirmation_required: 'recurring_total_change', baseline_monthly_cents, resulting_monthly_cents }`.
   - The wizard shows a confirm dialog with both server-computed values. Confirming resubmits
     with the acknowledgement.

   An unedited resume now round-trips exactly, so it never prompts. An edit that changes the
   total always prompts. The client never has to reproduce the server's math. That matters
   because the server's catalog and mode-default fallbacks differ from
   `fixedServicesRecurringTotalCents`.
7. **The bundle conversion total is included but committed separately (row 6).** It is the same
   kind of revenue loss on the same path, and the card names fractional quantities as the trigger.
   It gets its own commit so the reviewer can split it out to a follow-up ticket if wanted.
   **The reviewer should confirm this is in scope.**

## 3. Design

### 3.1 Shared type (`packages/types/src/interfaces/contractSimulation.interfaces.ts`, or a new `contractWizard.interfaces.ts` re-exported from the index)

```ts
export interface ContractWizardFixedService {
  service_id: string;
  service_name?: string;
  quantity: number;                       // allocation (bundle) or seats (unit)
  pricing_basis: FixedPricingBasis;       // 'bundle' | 'unit'
  unit_rate?: number | null;              // minor units, unit only
  bucket_overlay?: BucketOverlayInput | null;
}
export interface ContractWizardFixedLine {
  line_key: string;                       // stable client key (uuid); source contract_line_id on resume
  source_contract_line_id?: string;       // informational; finalize does not reuse ids
  contract_line_name?: string;
  description?: string | null;
  location_id?: string | null;
  billing_frequency?: string;             // falls back to contract billing_frequency
  billing_timing?: 'arrears' | 'advance'; // falls back to contract billing_timing
  enable_proration: boolean;
  base_rate?: number | null;              // bundle total, minor units; null = follow catalog
  services: ContractWizardFixedService[];
}
```

The following fields are removed: `fixed_services`, `fixed_base_rate` and
`fixed_billing_frequency` from `ContractWizardData`, `DraftContractWizardData`,
`ClientTemplateSnapshot` and `ContractDraftSimulationInput`. Contract-level `enable_proration`
stays, because the products line still uses it.

**Submission boundary.** `ClientContractWizardSubmission` takes `fixed_lines`. The old fields
(`fixed_services`, `fixed_base_rate`, `fixed_billing_frequency`) are still accepted from
non-wizard callers, such as about 20 integration tests and API callers. A single function,
`normalizeFixedLinesInput(submission)`, turns them into exactly one line. Supplying both shapes
is rejected. Mark it `// LEVERAGE: friction wizard-fixed-legacy-input — remove once callers send fixed_lines`.

### 3.2 Canonical recurring shape: `packages/billing/src/lib/contractRecurringShape.ts` (new, pure)

- `type RecurringShape` is a normalized, sorted list of the entries that affect revenue:
  - **fixed line**: frequency, timing, location, proration, bundle base rate (null when the line
    has no bundle member), sorted members (`service_id`, basis, quantity, unit_rate)
  - **product**: service, quantity, rate, frequency, location
  - **hourly service**: service, rate, frequency, timing, location, minimum, round-up, bucket
  - **usage service**: service, rate, unit of measure, frequency, timing, location, bucket

  Hourly and usage entries are compared per service, so merging several hourly lines that share
  every attribute into one line does not change revenue and passes.
- `recurringShapeFromStoredLines(detailedLines, servicesByLineId)` reads the rows
  `getDraftContractForResume` already loads (`fetchDetailedContractLines` plus
  `getContractLineServicesWithConfigurations`) and needs no extra queries. This requires adding
  `location_id` and `description` to the `fetchDetailedContractLines` select if they are missing.
- `recurringShapeFromWizard(data)` builds the shape from the resumed `DraftContractWizardData`,
  applying the same defaults finalize applies.
- `diffRecurringShapes(a, b): RecurringShapeDifference[]` returns one item per difference, each
  with a line label and a message.

### 3.3 Resume (`getDraftContractForResume`)

- One `fixed_lines` entry per `Fixed` line that has at least one non-product member, or that has
  **no members and a non-null `custom_rate`** (the service-less custom line, kept with
  `services: []` and `base_rate = custom_rate`).
  - A `Fixed` line whose members are all products feeds `product_services`, as today.
  - A `Fixed` line mixing products and services is left to the fidelity check, which refuses it.
  - Each line keeps its own `custom_rate`, `enable_proration`, `billing_frequency`,
    `billing_timing`, name, description and `location_id`.
- `fixed_lines` follows `display_order`.
- After building the wizard data, compute
  `diffRecurringShapes(fromStoredLines, fromWizard)`. If they differ, return
  `actionError(<itemized message>, 'msp/contracts:errors.wizard.resumeUnsupportedShape', { lines })`.
  The message is: "This draft can't be opened in the setup wizard without changing its pricing:
  <line: reason>…. Edit it from the contract's Lines tab or discard it."
- Return `recurring_baseline: { monthly_cents }` from `getContractMonthlyFixedValuesByContract`.
  The Review step shows it next to the estimate, labelled "Saved draft value".
- Contract-level `billing_timing` and `cadence_owner` are taken from the non-fixed lines when
  there are any, and otherwise from the first fixed line. This replaces last-wins.

### 3.4 Template snapshot (`getContractTemplateSnapshotForClientWizard`)

Same per-line mapping into `fixed_lines`, which removes the `fixedBaseRateCents` last-wins at
`:1940`. Templates have no `location_id`. No fidelity refusal is needed here: the snapshot is a
starting point the user edits, not a round-trip. Instead, the mapping is lossless by
construction because every template line becomes a wizard line.

### 3.5 Finalize / Save Draft (`createClientContractFromWizard`)

1. `normalizeFixedLinesInput`, then `assertFixedServiceBasisInputs` over all line members.
2. Currency coverage (`:1155-1180`) becomes per line: bundle members are covered when **their
   own line** has `base_rate > 0`.
3. Write one `contract_lines` row per fixed line, in order, with:
   - `contract_line_name`: the line's name, or `${contract_name} - Fixed Fee`, with ` (n)` added
     when there is more than one line
   - `description`, `location_id`
   - `billing_frequency`: the line's, else `submission.fixed_billing_frequency`, else
     `submission.billing_frequency`
   - per-line `billing_timing` passed through `resolveRecurringAuthoringPolicy`
   - per-line `enable_proration`
   - `custom_rate`: the line's base rate, through the `ContractLineFixedConfig.upsert` path used
     today

   Members are written through the existing per-member loop, which becomes a helper
   `writeFixedLineMembers(trx, lineId, line, modeDefaults)` that keeps the
   `allocateBundleBaseRate` shares **per line**. The loop is extracted rather than duplicated.
   Reuse `ensureRecurringAuthoringCombination` and `getUnsupportedRecurringAuthoringCombination`
   per line.
4. A line with `services.length === 0`:
   - Draft: write the `contract_lines` row only, as quote conversion does, so it round-trips.
   - Finalize: throw the `FIXED_LINE_NO_SERVICES`-style message from §2.4, and register it in
     `contractWizardActionErrorFrom`.
5. **Guard (existing draft only):**
   - Read `before` before `clearExistingContractData`, and `after` after the bucket-pool step,
     both with `getContractMonthlyFixedValuesByContract(trx, tenant, [contractId])`.
   - If they differ and the acknowledgement does not match, throw
     `RecurringTotalChangeRequiresConfirmation` (a local error class) inside the transaction.
   - The outer catch maps it to the `confirmation_required` result variant.
   - `ContractWizardResult` gains that variant. Add an `isRecurringChangeConfirmation()` type
     guard next to `contractWizardActionErrors.ts`.
   - New contracts skip the guard.
6. The submission gains `recurring_change_ack?: { baseline_monthly_cents: number }`.

### 3.6 Quote conversion (`quoteConversionService.ts`)

- **Preview.** An included recurring item without `service_id` goes to `excluded_items` with the
  existing reason and sets a new `contract_blocked_reason`. `available_actions` drops
  `contract`/`both` while one is present.
  - Check the conversion dialog (`QuoteConversionDialog`, under `packages/billing/src/components/billing-dashboard/quotes/`).
    It should show the blocking reason, not just hide the buttons.
- **Convert.** `convertQuoteToDraftContract` throws
  `Recurring item "<description>" must reference a catalog service before contract conversion`
  before writing anything.
- **Separate commit: bundle line total (row 6).** For a bundle-priced `Fixed` row, set the line
  `custom_rate` to `round(quantity × unit_price)`, which is the quoted recurring amount, using
  `item.total_price` when it is present and consistent. Leave the member
  `contract_line_service_fixed_config.base_rate` as the allocated share, matching what the wizard
  writes, so that the derived-rate path never multiplies again.
  - Update `contractServicesPerSeatQuote.integration.test.ts` › "keeps bundle pricing for products
    and custom items". The custom item now blocks conversion, and the product assertion is
    unchanged.

### 3.7 Wizard UI

- **`ContractWizard.tsx`.** Change the data shape, `buildSubmissionData` (projecting
  `fixed_lines` through `projectFixedServicesForSubmission` per line), step-1 validation,
  `getRecurringAuthoringValidationError` and the `createdContract` follow-up.
  - Step-1 validation checks the basis issue per line, and requires a base rate when a line has
    a bundle member.
  - `getRecurringAuthoringValidationError` runs per line, using the line's frequency and timing.
  - The `createdContract` follow-up fires when `fixed_lines.length > 0`.
  - Handle the `confirmation_required` result in `handleSubmit` and `handleSaveDraft` with a
    `ConfirmationDialog` (id `recurring-total-change-confirm`). The dialog says: "This changes
    the contract's estimated monthly recurring value from {before} to {after}." Actions are
    "Go back" and "Confirm and continue".
- **`FixedFeeServicesStep.tsx`.** Render one card per fixed line (`fixed-line-{index}`).
  - Each card has its own base-rate input (`fixed-line-{index}-base-rate`), service rows
    (`fixed-line-{index}-service-select-{j}`, `…-quantity-{j}`, `…-remove-service-{j}`), an
    optional name, and a remove-line button.
  - Add an "Add fixed line" button (`add-fixed-line-button`).
  - A new contract starts with one empty line, so the single-line experience looks the same as
    today.
  - A service-less line shows an inline warning (`fixed-line-{index}-no-service-warning`).
  - Today's `baseRateInput` local state becomes per-line. Lift it into a child
    `FixedLineEditor` component.
- **`ReviewContractStep.tsx`.**
  - One section per fixed line.
  - "Estimated Monthly Total" is the sum of `fixedServicesRecurringTotalCents(line.services, line.base_rate)`
    over the lines, normalized to monthly by frequency, plus the existing product total.
  - Show "Saved draft value" (`recurring_baseline`) when resuming.
- **Draft simulator.** `ContractDraftSimulationInput` takes `fixed_lines`, and
  `draftContractToScenario.ts` emits one scenario line per fixed line.
- **i18n.** Add the new keys to `server/public/locales/*/msp/contracts.json` for every locale
  (en, de, es, fr, it, nl, pl, pt, sv, plus the xx/yy pseudo-locales), following the repo's
  existing practice:
  - `wizard.fixedLines.*`
  - `wizard.validation.fixedLineNoService`
  - `wizard.recurringChange.*`
  - `errors.wizard.resumeUnsupportedShape`

## 4. Files to change

| File | Change |
|------|--------|
| `packages/types/src/interfaces/contractSimulation.interfaces.ts` (+ index export) | `ContractWizardFixedService` / `ContractWizardFixedLine`; `ContractDraftSimulationInput.fixed_lines` |
| `packages/billing/src/lib/contractRecurringShape.ts` (new) | Canonical shape, the two projections, diff |
| `packages/billing/src/lib/fixedServiceBasis.ts` | `fixedLinesRecurringTotalCents(lines)` helper (sum per line, monthly-normalized) |
| `packages/billing/src/repositories/contractLineRepository.ts` | Select `location_id`, `description`, `enable_proration` for contract lines if not already selected |
| `packages/billing/src/actions/contractWizardActions.ts` | Types; `normalizeFixedLinesInput`; per-line finalize writer; service-less finalize refusal; monthly-value guard and `confirmation_required` result; resume per-line mapping, fidelity check, `recurring_baseline`; template snapshot per-line |
| `packages/billing/src/actions/contractWizardActionErrors.ts` | Register new messages; `isRecurringChangeConfirmation` guard |
| `packages/billing/src/services/quoteConversionService.ts` | Preview blocking for service-less recurring items; convert throws; (separate commit) bundle line total |
| `packages/billing/src/components/billing-dashboard/quotes/*Conversion*.tsx` | Surface `contract_blocked_reason` |
| `packages/billing/src/components/billing-dashboard/contracts/ContractWizard.tsx` | `fixed_lines` state, validation, submission, confirmation dialog |
| `packages/billing/src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx` (+ new `FixedLineEditor.tsx`) | Multi-line editor |
| `packages/billing/src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep.tsx` | Per-line review, totals, baseline |
| `packages/billing/src/components/billing-dashboard/contracts/Contracts.tsx`, `ClientContractsTab.tsx` | Type only (`DraftContractWizardData`). The resume-refusal toast already works |
| `ee/server/src/lib/billing/simulator/draftContractToScenario.ts` | One scenario line per fixed line |
| `server/public/locales/*/msp/contracts.json` | New strings |

## 5. Tests

**Unit: `packages/billing/tests/draftContractForResumeActions.test.ts` (extend).**
1. Two bundle fixed lines ($3,000 with services A and B; $1,050 with service C) resume as two
   `fixed_lines`, each with its own `base_rate`, members, frequency and proration.
2. A service-less custom fixed line (`custom_rate` 70000, no members) resumes as a line with
   `services: []` and `base_rate: 70000`.
3. Mixed: one fixed line with a unit member (5 × $150) and a bundle member ($500), plus a second
   bundle line. Basis, quantity and unit_rate are kept per member, and base_rate per line.
4. Rivermark per-seat shape: three unit-priced lines (whole quantities) resume as three lines with
   unchanged quantity and unit_rate, and `base_rate` null.
5. A fixed line mixing product and service members returns `resumeUnsupportedShape` naming the line.
6. Two hourly lines with different `billing_frequency` return `resumeUnsupportedShape`. Two
   hourly lines with equal attributes resume (merged).
7. Template snapshot with two fixed lines gives two `fixed_lines` (no last-wins).

**Unit: `packages/billing/src/lib/contractRecurringShape.test.ts` (new).** Projections agree for
every shape above. The diff reports a rate change, a dropped line and a frequency change.

**Unit: `packages/billing/tests/contractWizardClientSubmission.test.tsx`, `contractWizardResume.test.tsx`, `fixedFeeServicesStep.baseRate.test.tsx` (update + extend).**
- Submission carries `fixed_lines`.
- Per-line base-rate validation.
- A service-less line blocks Finish and allows Save Draft.
- `confirmation_required` opens the dialog. Confirming resubmits with `recurring_change_ack`.

**Integration: `server/src/test/integration/contractWizard.integration.test.ts` (new `describe('finalize preserves recurring totals')`).**
1. Seed a draft with two bundle fixed lines at different rates. Resume, then finalize unchanged.
   The lines are rebuilt with the same per-line `custom_rate` and member shares, and
   `getContractMonthlyFixedValuesByContract` is equal before and after.
2. Seed a quote-converted draft with a service-less custom line:
   - Resume, then finalize unchanged: refused with the no-service message, nothing written
     (rollback).
   - Resume, then Save Draft unchanged: the line still exists with the same `custom_rate`.
3. Mixed unit + bundle draft: finalize unchanged, totals equal.
4. Rivermark per-seat quote (3 unit lines, $4,200/mo): convert, resume, finalize. $4,200 before
   and after, with three lines.
5. Guard:
   - Finalize a submission whose fixed total differs from the stored one (e.g. a lowered
     `base_rate`) without an ack. Returns `confirmation_required` with both values, and the DB
     is unchanged.
   - With a matching ack it commits.
   - With a stale ack (wrong baseline) it is refused again.
6. A legacy `fixed_services` + `fixed_base_rate` submission still creates one line. Supplying both
   shapes is rejected.

**Integration: quote conversion (`contractServicesPerSeatQuote.integration.test.ts`).**
- A service-less recurring item blocks the preview and conversion.
- Separate commit: a fractional bundle item (2.5 × $100) converts to a line `custom_rate` of
  25000 and bills $250.

**EE: `contractSimulatorDraftPerSeat.integration.test.ts`.** Two fixed lines simulate as two lines.

## 6. Out of scope / follow-ups

- alga0002267 ("Set to Active" does nothing). The resume-refusal message points to the contract
  Lines tab and to Discard, so it does not depend on 2267.
- Keeping hourly/usage line identity (name, `location_id`) when several same-attribute lines are
  merged. Revenue is unaffected and the fidelity check refuses any case where location or
  frequency differs.
- `contractMonthlyValue` counts `custom_rate` on member-less lines even though the engine refuses
  to bill them. This becomes moot for new data once conversion blocks such items. A follow-up
  should make valuation and engine agree.
- Finalize still deletes and rebuilds rather than reconciling lines in place. Line ids change and
  `time_entries.contract_line_id` is nulled, as today. For drafts this is acceptable. Note it as
  `// LEVERAGE: friction wizard-delete-and-rebuild` at `clearExistingContractData`.

## 7. Build order

1. Shared types and `contractRecurringShape` with its unit tests.
2. Server: finalize writer per line, the legacy-input adapter and the guard, with integration
   tests 1, 3, 5 and 6.
3. Server: resume per-line mapping, the fidelity check and the template snapshot, with unit
   tests 1–7.
4. Quote conversion blocking (tests 2 and 4), then the separate bundle-total commit.
5. Wizard UI: multi-line step, review, confirmation dialog, i18n, plus the UI unit tests.
6. EE simulator.
7. Manual smoke (not part of this design step):
   - Rivermark Q-0017-shaped quote: convert, Resume, Finish. Totals unchanged.
   - Two-bundle draft: Resume, Finish. Two lines.
   - Custom-item quote: conversion blocked.
