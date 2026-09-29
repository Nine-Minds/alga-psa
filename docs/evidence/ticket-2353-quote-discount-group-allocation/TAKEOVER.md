# Takeover completion

The takeover builds on `0354bb9f41`. It retains the builder's verified recurring
allocation, unmatched-target copy repair, and fixed allocated invoice discounts.
The remaining changes are in `quoteConversionService.ts`, the conversion preview
interface, and the two quote conversion dialogs.

## Final behavior

| Case | Before takeover | After takeover |
|---|---|---|
| Three $10 products less $1 | Shared preview throws, preventing invoice conversion | Invoice remains $29; sales order has one unit at $9.66 and two at $9.67 |
| Existing $10 product order, $10 service, $4 whole-quote discount | Preview invents an $8 order price; $8 invoice plus actual $10 order loses $2 discount | Preview shows actual $10 order; invoice action is disabled and execution rejects before writes |
| Same order explicitly reconciled to $8 | No destination verification | Invoice action becomes available; $8 order + $8 invoice = $16 |
| Repeated sales-order conversion after a price split | Previously unsupported split | Returns the original order and its two lines; no duplicate quantity |

New sales orders split a product quantity across at most two adjacent cent
prices. The sum of quantities, net amounts, and per-unit cost snapshots is
preserved. Preview and persistence call the same pricing function.

For existing orders that claim discounted products, compare quantity and net
amount per service with the quote's derived allocation. Equivalent line splits
are accepted. A mismatch returns `invoice_error`, removes invoice/both from
available actions, and disables the invoice button in both quote dialogs.
Execution repeats this check before invoice numbering or inserts. Existing
orders are not automatically repriced; contract conversion remains available.
This is a deliberate compatibility guard for historical or manually edited
orders, not a data backfill.

## Verification

- The two new preview tests failed before the fix: an indivisible-price exception
  and stored $10 incorrectly displayed as $8.
- Final focused run: **215 passed across 8 files** (101 unit, 114 DB-backed).
  Saved output: `takeover-tests.txt`.
- New DB cases T215 (direct invoice and sales order) and T216 exercise persisted
  amounts, quantity/cost preservation, idempotent retry, no writes on a rejected
  legacy conversion, and successful conversion after explicit reconciliation.
- Existing copy, optional-selection, capped/stacked/percentage, legacy load/save,
  tax, and quote conversion suites remain green.
- `npm -w @alga-psa/billing run typecheck` passed.
- `npm -w @alga-psa/billing run build` passed.
- Focused ESLint: 0 errors, 41 existing warnings in touched files.
- Plan validator: 18 features, 20 test entries; valid. `git diff --check` clean.

Use the commands in REVIEW.md from `server/`, with a unique TEST_DB_NAME such as
`test_database_2353_takeover`. The takeover ran all six listed unit suites and
both infrastructure suites together against local port 5472.

## Rendered evidence and limits

The committed editor screenshot `editor/2353-editor-reopen-50monthly.png` and
standard/custom PDFs still cover the unchanged quote rendering: $50 monthly,
$2,987.97 one-time, and $3,037.97 overall. Prior pre-fix PDF evidence shows $60
monthly and $2,997.97 one-time; it does not reproduce the customer's reported
subtraction direction. That exact historical PDF remains unresolved.

No shared template catalog was touched during takeover. Earlier standard-PDF
verification used the documented temporary shared-row swap and restoration.
No new live screenshot of the conversion warning is claimed: the Alga Dev
browser CLI timed out twice, and Browser discovery returned no connected
browsers. The new preview behavior and persisted conversion paths are verified
by runtime tests; the two dialog controls were typechecked and reviewed.

Review the legacy-order guard and quantity split first. Before production
verification, use the normal approval gates, check the deployed version/routing,
and regenerate the affected quote's preview/PDF without changing customer data.
This draft remains local: no push, PR, merge, deployment, or customer message.
