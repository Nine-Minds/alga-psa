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

The new migration `20260923000000_add_adjustment_provenance_to_invoice_charges.cjs`
was applied to the dev database before the final save (the worktree dev
database did not auto-run it).

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
   at one and the totals did not change.

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

# DB-backed behavior (persistence, idempotency, prohibited edits)
cd server && npx vitest run ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts

# Types and build
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit -p packages/billing/tsconfig.json
npx tsc --noEmit -p packages/types/tsconfig.json
cd packages/billing && npx tsup
```

## Cleanup / caveats

- The seeded discount is active for the synthetic client and will keep applying
  to other `Mountain Dental` contract drafts edited through the new path. Delete
  `contract_line_discounts` and `discounts` rows for
  `5a1e0000-0000-4000-8000-0000000000a3` (and the smoke invoice) to remove it.
- The manual line is taxable in the client region, so the invoice total carries
  $9.00 tax; the acceptance figures are pre-tax subtotals.
- Automatic contract-change (true-up) settlement is not exercised here: the
  companion card owns effective-history and its baseline policy is
  next-period-only with no mid-period true-up. The manual partial-period path
  covers both increase and decrease directions.
