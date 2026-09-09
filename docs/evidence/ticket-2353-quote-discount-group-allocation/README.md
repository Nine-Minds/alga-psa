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
| Recurring / month (sidebar) | $50.00 | QuoteForm now derives the figure from per-base allocations: **$50.00 recurring / month** on create and after save/reopen |
| One-time net | $2,987.97 | `onetime_subtotal` 298797 = **$2,987.97** |
| Overall discount | $10.00 | `discount_total` 1000 = **$10.00** |
| Overall total | $3,037.97 | `total_amount` 303797 = **$3,037.97** |

Persistence after save/reload: `quotes` row = subtotal 304797, discount_total
1000, tax 0, total_amount 303797. Discount rows remain positive (500) with
`is_recurring=false`, `billing_frequency=null`. Adapter view model puts the two
discount rows in `recurring_items` as −500 each and leaves one-time untouched.

## Read-time compatibility policy (legacy financials)

The adapter no longer trusts persisted `discount_total`/`total_amount` when
they disagree with the derived allocation (unmatched targets, oversized
discounts saved before this change). It reports derived figures everywhere:
positive discount rows in `line_items` carry their derived resolved amount,
group totals subtract the same allocations, and overall `subtotal`,
`discount_total`, `tax`, and `total_amount` are computed from the included
bases and resolved discounts. Storage is untouched (no backfill); a later save
recalculates the stored row identically. See adapter tests T211/T212 (legacy
oversized and unmatched fixtures written under the old rules) and the unified
eligibility tests (T210) for the exact numbers.

## Artifacts

- Editor (browser screenshots, port 3172):
  - `editor/2353-editor-six-items-no-discount.png` – six base rows; sidebar
    Subtotal $3,047.97 / Discounts $0.00 / Total $3,047.97.
  - `editor/2353-editor-reopen-50monthly.png` – the quote with both discounts
    after save + reload (legacy-style persisted discounts): rows show
    `- USD 5.00`; sidebar reads **$50.00 recurring / month**, Subtotal
    $3,047.97 / Discounts −$10.00 / Tax $0.00 / Total $3,037.97 (fixes review
    gap #1).
- PDFs (rendered by the quote PDF service from the DB quote):
  - `pdfs/QUO-0003-grouped-custom-template.pdf` – custom template whose AST is
    a copy of this branch's `buildStandardQuoteGroupedAst()` (the
    duplicated/custom template requirement; binds `recurringItems`,
    `onetimeItems`, `recurringSubtotal`, `onetimeTotal` directly).
  - `pdfs/QUO-0003-standard-grouped-isolated-catalog.pdf` – the normal
    standard-template selection path exercised via a temporary swap of the one
    shared catalog row to this branch's canonical AST, restored afterwards
    (see `preview/2353-standard-catalog-blocker.txt` for the exact
    backup/replace/generate/restore procedure; ticket 2354's shared catalog
    AST was restored byte-for-byte).
  - `pdfs/QUO-0003-standard-grouped-code-ast.pdf` – same render with
    `getStandardQuoteTemplateAstByCode('standard-quote-grouped')` supplied
    explicitly.
  - `pdfs/QUO-0003-PRE-FIX-adapter-grouping.pdf` – the faithful fixture
    rendered through the PRE-FIX adapter grouping (see sign-behavior note
    below and `preview/pre-fix-viewmodel.json`).
  - `preview/*.txt` – `pdftotext -layout` transcripts of each PDF.
  - `preview/viewmodel.json` – post-fix adapter figures; `preview/pre-fix-viewmodel.json` – pre-fix figures.
- Pre-fix reproduction:
  - `pre-fix-adapter-reproduction*.txt` – adapter tests against the pre-fix
    adapter (6 failed / 6 passed); same suites pass post-fix.

## Pre-fix sign behavior (what local evidence establishes)

Pre-fix PDF/view model (QUO-0003-PRE-FIX*) show the old adapter classified the
two legacy discounts by their own cadence (`is_recurring=false`) into the
one-time group as **positive** $5 rows, so One-time rendered $2,997.97 and
Monthly stayed $60.00. That is a misclassification + sign bug, but it does not
explain the customer's reported "one-time charges decrease by $10"
subtraction. That specific subtraction is **not reproduced** by local evidence
and remains unresolved; no claim of reproducing the customer's exact PDF is
made.

## Blockers / caveats

- Standard "Grouped Quote Template (Standard)" selection in this shared dev DB
  hits the ticket-2354 catalog AST interference described in
  `preview/2353-standard-catalog-blocker.txt`. It was verified via an isolated
  catalog swap; the shared catalog was restored byte-for-byte. Whether merging
  ticket 2354 resolves this depends on its schema/catalog work landing first;
  that is a coordination item, not an assertion made here.
- Tax: new items under the Emerald City client defaulted to 6%; fixture rows
  were flagged non-taxable and re-saved through the app to mirror the zero-tax
  customer scenario. Tax behavior itself is unchanged.
- This browser harness does not persist downloads to disk; PDFs were produced
  by the same server code path (`downloadQuotePdf` → `pdfService.generatePDF`)
  in a harness against the same quote/template/user.
- Production re-verification (tenant 8ec33c81…, QUO-0001 b0ba8a84…) belongs
  to a later approved deployment and was not performed.
