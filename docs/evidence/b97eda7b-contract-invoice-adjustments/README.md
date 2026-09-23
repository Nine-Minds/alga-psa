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
