# Contract invoice adjustments — UI smoke evidence

Card: `b97eda7b-0e3f-4b09-be80-6b57f934d8a5`
Run at: 2026-09-23, worktree dev server on `http://localhost:3185` (compose project `alga-psa-local-test`, database `server` on Postgres 5472).

This is a manual, in-browser smoke of the entry point and the customer-facing
output. It complements the unit and DB-backed behavioral tests; it is not a
substitute for them.

## Fixture

Isolated synthetic contract draft, seeded directly for the smoke:

- Invoice `5a1e0000-0000-4000-8000-0000000000a1` — `SMOKE-ADJ-1`, client
  `d0000000-0000-4000-8000-000000000001` (Mountain Dental), USD, draft,
  `is_manual = false`.
- Generated recurring charge `5a1e0000-0000-4000-8000-0000000000a2` — $3,900.00
  (390000 minor units), `is_manual = false`, read-only in the editor.
- Configured automatic discount `5a1e0000-0000-4000-8000-0000000000a3` —
  "Smoke 10% (all eligible)", percentage 0.10, active, linked through
  `contract_line_discounts` to the client's contract line.

Two migrations back this behaviour and were applied to the dev database before
the final save (the worktree dev database did not auto-run them):

- `20260923000000_add_adjustment_provenance_to_invoice_charges.cjs` — charge
  provenance plus the `(tenant, invoice_id, adjustment_source_kind,
  adjustment_source_id)` unique index that makes one settlement per source a
  database invariant.
- `20260923010000_invoice_adjustment_settlement_support.cjs` — explicit
  discount `scope`/`scope_service_id`/`applies_to_item_id`/`priority`, the
  affected `adjustment_period_start`/`_end` on a settlement row, and the
  `invoices.draft_adjustment_revision` + `invoice_adjustment_operations`
  manual-save idempotency ledger.

## What was exercised

1. Billing → Invoicing → Drafts, search `SMOKE-ADJ`, select `SMOKE-ADJ-1`.
2. The **Invoice adjustments** card appears above the preview with generated
   lines read-only and `Add Charge`, `Add Discount` and `Add partial-period
   charge` actions — screenshot `b97eda7b-01-adjustments-entry.png`.
3. Added a partial-period charge with the form defaults
   `3 × $100.00 × 15/30`; the dialog resolved it to `$150.00` before saving.
4. Saved. The automatic 10% discount was reconciled in place against the
   post-edit eligible base and the full authoritative invoice came back.
5. Saved a second time to confirm idempotency; the discount row count stayed
   at one and the totals did not change. The save also carries a per-edit
   operation id and the loaded `draft_adjustment_revision`, so a replayed
   submit is a server-side no-op and a stale revision is rejected before any
   row is touched.

## Fresh smoke after review fixes (same run, 2026-09-23)

The review round required a fresh browser pass plus the financial-path fixes.
The fixture now carries the contract assignment on the recurring charge
(`client_contract_id` = the `client_contracts` row for the discounted contract
line), which is what generated invoices do; the earlier hand-seeded fixture
omitted it.

1. Reloaded the page, searched `SMOKE-ADJ` and selected `SMOKE-ADJ-1`.
2. `Add Charge` opened a freeform line; the editor renders a **Location** and a
   **Billing profile** select under the rate field — screenshot
   `b97eda7b-04-attribution-controls.png`. Location is populated from
   `getActiveClientLocationsForBilling` and profile from
   `getClientBillingProfilesForBilling`; both default to “Client default”.
3. Added `Smoke attribution charge` at `$10.00`, selected `Downtown Office` and
   the `Mountain Dental` profile, clicked the row’s **Add** to commit it to the
   editor, then **Save Changes**.
4. The save persisted the line with `location_id` =
   `cccccccc-0000-4000-8000-0000000000c1` and `billing_profile_id` =
   `ddf20f87-972f-48ad-a62e-7e1ac430b3bb`, and re-applied the automatic 10%
   discount against the new eligible base `$4,060.00` → `-$406.00`.
5. Reloaded the page; the editor and the customer-facing **Invoice Preview**
   both showed the four persisted lines and the same totals — screenshot
   `b97eda7b-03-adjustments-after-save.png`. Stored rows: `390000 + 15000 +
   1000 − 40600 = 365400` subtotal, `900` tax, `366300` total.
6. The fixture was then restored to the canonical three-line acceptance state
   (`$3,900 + $150 = $4,050`, 10% = `-$405`, `$3,645` net) so the table below
   still describes the persisted fixture.

The run also caught a real server-action defect that typecheck cannot see:
`invoiceModification.ts` is a `'use server'` module and had exported a
non-async `STALE_ADJUSTMENT_REVISION` constant, which made the whole Billing
page return HTTP 500. It is now module-local (the code is a string literal at
its only other call sites).

## Edit-path smoke (Draft Implementation completion, 2026-09-23)

A second in-browser pass exercised the **update** path (editing an existing
manual line) rather than only add/remove, because the completion round fixed the
stale `net_amount` on edited one-time charges:

1. Selected `SMOKE-ADJ-1` from Drafts; the **Invoice adjustments** card showed
   the canonical three-line state: `$3,900` recurring + `$150` manual =
   `$4,050` eligible, `-$405` automatic discount, `Total: $3,645.00` —
   screenshot `b97eda7b-05-edit-path-smoke.png`.
2. `Add Charge` → `Smoke edit charge`, qty `1`, rate `$20.00`, committed and
   saved. Persisted `unit_price=2000`, `net_amount=2000`; the automatic
   discount re-based to `-$407`; total `$3,663.00`.
3. Reopened the row, changed quantity to `3`, clicked the row **Add** and
   **Save Changes**. Persisted `quantity=3.00`, `unit_price=2000`,
   `net_amount=6000` (3 × $20.00); the automatic discount re-based to
   `-$411`; subtotal `$3,699.00`, total `$3,708.00`.
4. Reloaded the page via the invoice URL; the customer-facing **Invoice
   Preview** rendered the same four persisted lines (`3 × $20.00 = $60.00`,
   `-$411.00`, subtotal `$3,699.00`, tax `$9.00`, total `$3,708.00`),
   confirming the edit survives reload and preview agrees with storage.
5. Clicked **Download PDF**; the action's client blob path did not leave a
   locatable artifact in this run (it is not stored on disk) and the API PDF
   route requires an API key, so the edited-state PDF was not re-read this
   round. Preview and PDF share `mapDbInvoiceToWasmViewModel`, and the prior
   run's filed PDF (`Invoice_SMOKE-ADJ-1.pdf`, `pdftotext`-verified) covers the
   canonical state.
6. The fixture was restored via SQL to the canonical acceptance rows
   (`390000 + 15000`, discount `-40500`, subtotal `364500`, tax `900`, total
   `365400`). The password for the dev login was reset to a local value for
   this smoke.

## Customer-facing output

- **Preview**: the MSP `InvoicePreviewPanel` renders from the persisted rows and
  was verified line-for-line in the fresh run (screenshots 02/03).
- **PDF**: `Download PDF` filed and served the rendered artifact
  `Invoice_SMOKE-ADJ-1.pdf` (39,091 bytes) through `getStoredInvoicePdf`.
  `pdftotext` of the stored file shows all four adjustment lines and
  `Subtotal $3,654.00 / Tax $9.00 / Total $3,663.00`, matching the persisted row
  set and the preview.
- **Client portal**: **not verified in-browser.** `/client-portal/billing`
  refuses the active MSP session (“Portal Switch Required” → AccessDenied), and
  this worktree has no portal credential/invitation for the synthetic client.
  The portal consumes the same persisted rows through the same
  `mapDbInvoiceToWasmViewModel` adapter that produced the verified preview and
  PDF, so the amounts it renders are the same rows; only the portal session and
  its own chrome were not exercised.
- **Accounting export**: **not exercised against a live vendor and cannot pass
  as-is by design.** The automatic settlement and a freeform one-time charge
  carry no `service_id`, so `assertInvoiceExportReady`
  (`packages/billing/src/services/accountingSync/exportReadiness.ts:135`) blocks
  the QBO/Xero export with the actionable “line has no service assigned”
  blocker until an operator classifies it. That is the plan's requirement
  (“never fabricate recurring details to bypass this check”), not a defect; no
  live QuickBooks/Xero export was attempted for this draft.

## Expected vs actual

| Amount | Expected | Actual (stored) |
| --- | --- | --- |
| Generated recurring charge | $3,900.00 | 390000 |
| Manual partial-period line | $150.00 | 15000 (`manual_line_metadata.partialPeriod = 3 × $100.00 × 15/30`) |
| Eligible base | $4,050.00 | 405000 |
| Automatic 10% discount | −$405.00 | −40500 (source `discount`, scope `invoice`) |
| Net subtotal before tax | $3,645.00 | 364500 |
| Tax (client region) | — | 900 |
| Invoice total | — | 365400 |

The customer-facing **Invoice Preview** in the same drawer shows the generated
charge, the `Smoke 10% (all eligible)` discount line at `-$405.00`, the
`3 × $100.00 × 15/30` manual line at `$150.00`, and a `$3,645.00` subtotal —
screenshot `b97eda7b-02-preview-totals.png`. The editor total, the persisted
rows and the preview all agree, exercising the same persisted row set.

## Reproduction commands

```bash
# Unit (evaluator + allocation + partial-period maths)
cd packages/billing && npx vitest run src/lib/billing/compute/contractInvoiceAdjustments.test.ts

# DB-backed behavior (persistence, discount scopes, idempotency, prohibited edits)
cd server && npx vitest run ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts

# Manual-save idempotency, stale revision and the ledger table (real action path)
cd server && npx vitest run src/test/infrastructure/billing/invoices/contractInvoiceManualCredit.test.ts

# Generation regression for the existing discount surfaces
cd server && npx vitest run src/test/infrastructure/billing/invoices/billingInvoiceGeneration_discounts.test.ts

# Types and build
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit -p packages/billing/tsconfig.json
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit -p packages/types/tsconfig.json
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit -p packages/db/tsconfig.json
cd packages/billing && npx tsup
```

## Review-round financial fixes

- `calculateAndDistributeTax` calls
  `recalculatePercentageDiscountInvoiceCharges`, which used to overwrite *any*
  percentage discount row from the whole invoice subtotal (or one target item).
  A service-scoped or capped automatic discount was therefore silently rewritten
  during the tax pass. Source-linked settlements (`adjustment_source_kind` and
  `adjustment_source_id` both set) are now excluded from that legacy
  recalculation; manual percentage discounts keep the historical behaviour.
  The DB suite proves it end to end: reconcile two stacked 60% service-scoped
  discounts onto `$3,900` with a `$1,000` out-of-scope manual charge, run
  `BillingEngine.recalculateInvoice` (tax + totals) and assert the discount rows
  stay `-234000 / -156000` and the stored subtotal stays `100000`. Removing the
  exclusion reproduces the bug (`-294000 / -294000`).
- Discount eligibility is constrained to the contract lines actually represented
  on the invoice, via the charge’s `client_contract_id` and/or the canonical
  `invoice_charge_details.config_id → contract_line_service_configuration`
  link. A discount configured on another contract of the same client no longer
  applies (negative DB test), and the de-duplication order is deterministic
  (discount id, assignment id, contract-line id) rather than join order.
- Eligibility is now strictly **line-level**: when an invoice charge carries a
  canonical detail link, only that contract line is represented, so a discount
  on a sibling line of the same contract cannot apply. A represented assignment
  with no detail link at all (legacy charge) falls back to its whole line set;
  this is the documented contract-wide fallback, not an implicit narrowing.
- Editing an existing one-time manual row now recomputes `net_amount` /
  `total_price` from the persisted `quantity × unit_price` before the discount
  and totals passes (`updateManualInvoiceItemsInternal`, second pass). Previously
  an edited charge kept its stale amount in totals, automatic-discount bases and
  every output. Covered by the unit test
  `invoiceModification.manualRecurringGuard.test.ts` (`T230`) and the edit-path
  browser smoke above.
- Operator-supplied `location_id` / `billing_profile_id` are validated against
  the invoice’s client in `persistManualInvoiceCharges` and the update path
  (`validateManualChargeAttribution`), rejecting another client’s ids with
  `LOCATION_NOT_FOUND` / `BILLING_PROFILE_NOT_FOUND` before any row is written.
  Covered by the DB test “rejects a location and a billing profile that belong
  to another client”.

## Credit and sibling-line repairs (review follow-up)

- **Quantity>1 negative-rate credits.** A negative manual rate with quantity > 1
  is persisted through the first pass as a fixed discount-like credit with
  `net_amount = quantity × rate` (e.g. `3 × -$100 = -$300`) and `is_discount=true`;
  the editor reloads it as a fixed discount. An *authored* fixed discount is the
  other shape: `calculateNetAmount` stores `-abs(rate)` independent of quantity.
  Both shapes share `is_discount`/`discount_type='fixed'`, so the update path
  could not tell them apart: it dropped a credit's quantity (or, in the first
  fix, scaled an authored discount by quantity). `persistManualInvoiceCharges`
  now stamps quantity-derived credits with `is_manual_credit=true` (authored
  discounts stay `false`), and the fixed-discount recalc scales by quantity only
  when that flag is set. Migration
  `20260923020000_add_is_manual_credit_to_invoice_charges.cjs` adds the column
  and backfills only provable legacy credits (`net_amount = round(quantity ×
  unit_price)`, quantity ≠ 1), leaving authored discounts quantity-independent.
  Regressions: `contractInvoiceManualCredit.test.ts` `T231` adds a `3 × -$100`
  credit, resaves it through `updateInvoiceManualItems`, and asserts the row
  stays `-$300` and the invoice totals stay `$500 - $300 = $200`; `T232` adds an
  authored `$100` fixed discount with a stray quantity of 3, resaves it, and
  asserts it stays `-$100` (`$500 - $100 = $400`) instead of scaling to `-$300`.
- **Detail-backed sibling-line exclusion.** `contractInvoiceAdjustments.db.test.ts`
  now builds an invoice whose charge carries a canonical
  `invoice_charge_details.config_id → contract_line_service_configuration`
  link to the billed line, a discount on an unbilled sibling line of the same
  contract, and asserts the sibling discount is not applied (positive control:
  moving the same discount onto the billed line applies `25% × $3,900 = $975`).
  This proves the strict line-level eligibility change on the fixture it
  actually affects.

## Completion round: manual-credit UI and currency regression (2026-09-23)

The server half of the `is_manual_credit` distinction landed in `432b29a5bd`;
this round finishes the UI half and closes the test-suite gap it exposed.

- The editor now resolves a row's displayed amount through one shared helper,
  `resolveLineItemAmount` (`packages/billing/src/components/billing-dashboard/LineItem.tsx`):
  a quantity-derived operator credit (`is_manual_credit`) is `quantity × rate`,
  an authored fixed discount is quantity-independent (`-abs(rate)`), a
  percentage discount is `0` (priced server-side), and an ordinary charge is
  `quantity × rate`. `ManualInvoices.calculateManualItemsTotal` and the loaded
  row mapping use the same helper / flag, and
  `models/invoice.ts` selects `ic.is_manual_credit`.
- Non-USD regression added to
  `packages/billing/src/services/contractInvoiceAdjustments.db.test.ts`:
  an EUR draft with a manual partial-period line reconciles the same 10%
  automatic discount to `-40_500` minor units and totals `405_000 / -40_500 /
  364_500`, proving the adjustment path does not substitute USD or divide by
  100. Three-decimal currency precision remains out of scope per the plan.
- Repaired the `invoiceModification.updateDraftInvoiceProperties.test.ts`
  query-builder mock, which lacked `forUpdate` and so failed the finalized-
  invoice guard added by the editability work (a real regression from this
  branch, not a product defect).

Verification snapshot this round (all green, sequential runs — parallel vitest
processes corrupt the shared `test_database`):

| Suite | Result |
| --- | --- |
| `packages/billing` unit (full `npx vitest run`) | 311 files / 1555 tests |
| `contractInvoiceAdjustments.db.test.ts` | 19 tests |
| `contractInvoiceManualCredit.test.ts` | 4 tests |
| `billingInvoiceGeneration_discounts.test.ts` | 4 tests |
| `exportReadiness.test.ts` | 9 tests |
| `tsc --noEmit` billing / types / db | pass |
| `packages/billing` `npx tsup` | pass |

## Per-line tax treatment (Draft Implementation follow-up, 2026-09-23)

The draft-adjustment editor now exposes the Add Charge **tax treatment** the
plan requires, without changing the legacy manual-invoice generator.

- `LineItem` accepts optional `taxRateOptions` and renders a `Tax treatment`
  select (a `Non-taxable` default plus the tenant's rates) for non-discount
  charges only when options are supplied. `ManualInvoices` loads them through
  `getTaxRates()` only in `variant="draftAdjustments"`, so the legacy generator
  keeps its prior behavior (no control) and an empty/permission-denied result
  hides the control rather than defaulting taxability.
- The authoring field rides through `ManualInvoiceUpdate.tax_rate_id` and the
  new-item mapping. `resolveTaxRegionCodeForRate` resolves the id inside the
  tenant to the charge's `tax_region`/`is_taxable`; `validateManualChargeAttribution`
  rejects a foreign/unknown rate with `TAX_RATE_NOT_FOUND` before any row is
  written. The chosen id is echoed in `manual_line_metadata.tax_rate_id` so a
  reload restores the exact rate (region alone cannot disambiguate).
- The collapsed row's taxable badge now reflects the effective per-line
  treatment (`editState.tax_rate_id`) instead of only the selected service's
  default, so a freeform line with an explicit rate — or a service line whose
  operator overrode it to non-taxable — is labelled correctly while collapsed.
- An explicit Non-taxable choice is authoritative over a taxable catalog
  service. `persistManualInvoiceCharges` now distinguishes an absent choice
  (`tax_rate_id === undefined`, falls through to the service) from an explicit
  `null` (Non-taxable, no service fallback), and the edit path
  (`updateManualInvoiceItemsInternal`) derives `is_taxable`/`tax_region` from the
  selected treatment rather than trusting a stale payload flag. `ManualInvoices`
  also derives the payload `is_taxable` from the selection. Behavioral coverage:
  `contractInvoiceManualCredit.test.ts` T234 adds a taxable catalog service line
  with `tax_rate_id: null` (stored `is_taxable=false`, `tax_region=null`, `tax=0`,
  total `$100`), taxes it, then overrides a taxable catalog line back to
  Non-taxable with a deliberately stale `is_taxable: true` (stays non-taxable,
  `tax=0`, total `$100`). Both halves fail against the pre-fix source.
- The edit path now resolves every explicit tax treatment before updating any
  row and returns `TAX_RATE_NOT_FOUND` if a rate id cannot resolve to a region,
  so an unknown/cross-tenant (or otherwise unusable) id can never persist
  `is_taxable=true` with a null region and let tax fall back to the client
  region. `contractInvoiceManualCredit.test.ts` T235 sends an unknown tax rate
  on an existing line, asserts the action returns
  `{ success: false, code: 'TAX_RATE_NOT_FOUND' }`, and asserts the line
  (`is_taxable`, `tax_region`, `unit_price`, `net_amount`, description) and the
  invoice `tax`/`total_amount` are unchanged. With both the up-front guard and
  the attribution guard temporarily disabled the edit succeeds and the total
  wrongly becomes `$110`, proving the test is non-vacuous.
- Behavioral coverage: `LineItem.test.tsx` (the control reports the operator
  choice; it is absent with no options; the collapsed badge tracks the explicit
  treatment, including Non-Taxable on a taxable catalog service),
  `contractInvoiceAdjustments.db.test.ts` "persists an explicit per-line tax
  treatment and rejects a tax rate outside the tenant", and
  `contractInvoiceManualCredit.test.ts` T233, which now proves the taxable `$100`
  freeform line lands `$10` tax / `$110` total through the real action and
  returns to `0` when the treatment is cleared.

Verification snapshot this round (all green, sequential DB runs):

| Suite | Result |
| --- | --- |
| `packages/billing` unit (`npx vitest run`) | 311 files / 1558 tests |
| `contractInvoiceAdjustments.db.test.ts` | 20 tests |
| `contractInvoiceManualCredit.test.ts` | 7 tests |
| `billingInvoiceGeneration_discounts.test.ts` | 4 tests |
| `exportReadiness.test.ts` + `invoiceExportGuards.test.ts` | 13 tests |
| `GenerateTab.test.tsx` + `InvoicePreviewPanel.test.tsx` | 6 tests |
| `tsc --noEmit` billing / types / db | pass |
| `packages/billing` `npx tsup` | pass |

## Cleanup / caveats

- The seeded discount is active for the synthetic client and will keep applying
  to other `Mountain Dental` contract drafts edited through the new path. Delete
  `contract_line_discounts` and `discounts` rows for
  `5a1e0000-0000-4000-8000-0000000000a3` (and the smoke invoice) to remove it.
- The manual line is taxable in the client region, so the invoice total carries
  $9.00 tax; the acceptance figures are pre-tax subtotals.
- Automatic contract-change (true-up) settlement is deliberately absent, not
  merely unexercised: companion card `f6e7254b` owns effective-history and its
  recorded baseline is next-period-only with no mid-period true-up policy.
  There is no supported policy to settle, so provisioning one would be
  inventing product behaviour. The manual partial-period path covers both
  increase and decrease directions and is the supported way to settle a
  partial period.

## Recurring contract terms repair (2026-09-24 scope addition)

Captain scope addition: recurring client-specific terms are authored on the
client contract and billed through the existing evaluator, not copied forward as
manual invoice lines. This round finishes that capability on the existing
layers.

### What changed

- **Fixed-discount unit fixed.** `discounts.value` is `decimal(10,2)`: a fixed
  discount stores a decimal currency amount (`50.00` = $50.00) while a
  percentage stores a fraction (`0.10` = 10%). `buildAutomaticDiscountPolicies`
  passed the raw value to an evaluator that treats fixed values as minor units,
  so a configured $50 discount billed $0.50. The conversion now happens exactly
  once at that adapter boundary
  (`storedDiscountValueToPolicyValue`, `contractInvoiceAdjustments.ts`).
- **Configured discounts are authorable.** New `Discounts` tab on the client
  contract (`ContractDetail.tsx` → `ContractDiscounts.tsx`) backed by
  tenant-scoped, permissioned `discountActions.ts` (list/create/update/
  deactivate) that writes the existing `discounts` +
  `contract_line_discounts` model. Fixed/percentage value, start/end date, line
  association, scope (invoice / contract / service), priority and active flag are
  validated; item scope is rejected as non-authorable because an invoice
  charge's `item_id` is per-invoice.
- **Negative recurring rates blocked.** `custom_rate >= 0` is enforced in
  `createCustomContractLine`, `copyPresetToContractLine`, `updateContractLine`,
  `updateContractLineFixedConfig`, `updatePlanServiceFixedConfigRate` and
  `updateContractLineRate`, plus a tenant-safe database
  `CHECK (custom_rate IS NULL OR custom_rate >= 0)` added `NOT VALID` (then
  validated when no legacy negatives exist) with the existing negatives logged.
- **Editable invoice text.** `invoice_line_description` is now authorable in
  `CreateCustomContractLineDialog`, the live inline editor in `ContractLines.tsx`
  and `ContractLineEditDialog` (template lines gained the column; the template
  clone copies it onto the live line). The unused `ContractLineTypeRouter` was
  removed; `FixedContractLineConfiguration` stays as a tested component.
- **Authored line windows.** Nullable `start_date`/`end_date` on `contract_lines`
  (half-open), validated against the active `client_contracts` assignment,
  intersected with the assignment window in the billing engine and in both
  recurring-service-period materializers so partial first/last periods prorate
  through `enable_proration` and an ended line produces no later in-advance
  period. `contract_lines.is_active` is now filtered in the recurring line
  selection (it was not before).
- **Manual-row tax preservation.** Opening a taxable row with no stored
  `tax_region` and no service no longer resolves to `null` (Non-taxable) and
  strips its tax. The resolver falls back to the invoice client's default region
  so the reported Florida 6% case shows `US-FL`, and returns `undefined` for an
  unresolvable taxable row so an untouched open/save leaves the stored treatment
  alone. Extracted to `manualInvoiceTaxResolution.ts`.

### Verification

Sequential runs; the DB suites recreate the isolated `test_database` on
Postgres 5472.

| Suite | Result |
| --- | --- |
| `packages/billing` unit (`npx vitest run`) | 313 files / 1574 tests |
| `contractInvoiceAdjustments.db.test.ts` | 26 tests (fixed USD/EUR, window/assignment, negative-rate constraint) |
| `contractInvoiceManualCredit.test.ts` | 7 tests |
| `billingInvoiceGeneration_discounts.test.ts` | 4 tests |
| `contractDetailTabSwitch.ui.test.tsx` | 2 tests |
| `resolveEffectiveContractLineWindow` / `resolveInitialManualTaxRateId` | 13 tests |
| `node scripts/validate-translations.cjs` | 51 files, 0 errors |
| `node tools/i18n/find-untranslated-ui.cjs --fail-on-high` | passed |
| `tsc --noEmit` billing / types / db | pass |
| `packages/billing` `npx tsup` | pass |

### Live UI smoke limitation

The worktree app server (`:3185`) is deliberately stopped for this step and the
card browser panes still fail (`Session with given id not found`), so no new
in-browser pass was captured this round. The prior UI smoke evidence above still
describes the manual-adjustment editor; the new Discounts tab, line date fields
and invoice-text fields are covered by automated tests only. A reviewer should
exercise them live when a running service is available.

### Review guide

The served guide (`/home/robert/alga-review/b97eda7b-contract-invoice-adjustments/`)
now names the baseline tax rate **Florida Sales Tax (US-FL, 6%)** and identifies
step 2's manual row as **"Review one-time support"**.
