# Ticket 2353 rendered-evidence notes

Local verification host: `localhost:3172` (this worktree's dev server).
Tenant `dd8cb218-d46d-47f3-be27-8aa50aad5fce` (dev "Emerald City" universe),
client **Emerald City**, quote **QUO-0003** (`9f4886a0-a332-430e-9056-973aa35e43a1`),
title "QD2353 Recurring Discount Fixture".

Fixture (created through the real editor on port 3172):

| Line | Kind | Cadence | Amount (cents) |
|---|---|---|---|
| QD2353 Managed Support A | service (monthly) | recurring | 2500 |
| QD2353 Managed Support B | service (monthly) | recurring | 3500 |
| QD2353 Setup and onboarding | custom | one-time | 37353 |
| One-time charge 2 | custom | one-time | 210863 |
| One-time charge 3 | custom | one-time | 5581 |
| One-time charge 4 | custom | one-time | 45000 |
| Discount on Managed Support A | fixed / Specific Service | persisted `is_recurring=false`, `billing_frequency=null` | 500 |
| Discount on Managed Support B | fixed / Specific Service | persisted `is_recurring=false`, `billing_frequency=null` | 500 |

## Expected vs actual (zero tax)

| Figure | Expected | Actual (editor sidebar / DB / view model) |
|---|---:|---:|
| Monthly base | $60.00 | recurring item rows 2500+3500 = 6000 cents = **$60.00** |
| Monthly discounts | $10.00 | two −500 allocations in recurring group = 1000 cents = **$10.00** |
| Monthly net | $50.00 | `recurring_subtotal` 5000 = **$50.00** |
| One-time net | $2,987.97 | `onetime_subtotal` 298797 = **$2,987.97** |
| Overall discount | $10.00 | `discount_total` 1000 = **$10.00** |
| Overall total | $3,037.97 | `total_amount` 303797 = **$3,037.97** |

Persistence after save/reload: `quotes` row = subtotal 304797, discount_total
1000, tax 0, total_amount 303797. Discount rows remain positive (500) with
`is_recurring=false`, `billing_frequency=null`. Adapter view model puts the two
discount rows in `recurring_items` as −500 each and leaves one-time untouched.

## Artifacts

- Editor (browser screenshots, port 3172):
  - `editor/2353-new-quote-form.png` – new-quote form with client Emerald City.
  - `editor/2353-editor-six-items-no-discount.png` – six base rows; sidebar
    Subtotal $3,047.97 / Discounts $0.00 / Total $3,047.97.
  - `editor/2353-editor-with-discounts.png` – after adding two fixed discounts
    via Fixed Discount > Specific Service; rows show `- USD 5.00`; sidebar
    Subtotal $3,047.97 / Discounts −$10.00 / Tax $0.00 / Total $3,037.97.
  - `editor/2353-editor-reopen-legacy-style-discounts.png` – same quote after
    save + reload (legacy-style persisted discounts) recomputed to
    $3,037.97; DB totals 304797 / 1000 / 0 / 303797.
- PDFs (rendered by the quote PDF service from the DB quote):
  - `pdfs/QUO-0003-grouped-custom-template.pdf` – custom template whose AST is
    a copy of this branch's `buildStandardQuoteGroupedAst()` (the
    duplicated/custom template requirement; binds `recurringItems`,
    `onetimeItems`, `recurringSubtotal`, `onetimeTotal` directly). The UI
    "PDF" action for this quote returns HTTP 200.
  - `pdfs/QUO-0003-standard-grouped-code-ast.pdf` – identical render with
    `getStandardQuoteTemplateAstByCode('standard-quote-grouped')` supplied
    explicitly (see `preview/2353-standard-catalog-blocker.txt`).
  - `preview/*.txt` – `pdftotext -layout` transcripts of each PDF.
  - `preview/viewmodel.json` – adapter view-model figures (recurring 5000,
    onetime 298797, discount_total 1000, total 303797).
- Pre-fix reproduction:
  - `pre-fix-adapter-reproduction.txt` and
    `pre-fix-adapter-reproduction-2026-09-08-0132.txt` – adapter tests run
    against the pre-fix (HEAD) adapter: 6 failed / 6 passed. Same suites pass
    after the fix (see test summary).

## What the local rendering evidence establishes

Local preview/PDF show one-time charges unchanged at $2,987.97 while the two
service-targeted discounts reduce the Monthly group to $50.00, matching the
customer expectation and refuting the positive-discount-sum misclassification.
It does **not** reproduce the customer's exact PDF (different tenant, quote,
template, branding); production re-verification is out of scope for this
draft.

## Blocker for one UI path

`preview/2353-standard-catalog-blocker.txt` records why selecting the standard
"Grouped Quote Template (Standard)" in this shared dev database returns 500:
ticket 2354 has overwritten the shared standard-template catalog AST with
`lines` description columns this branch's evaluator schema cannot parse.
