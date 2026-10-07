# Contract invoice adjustments: implementation evidence

## Implement desk verification (2026-09-27)

Baseline: `4ff933a279`. This pass found and fixed gaps in the existing implementation:

- Template defaults now support edit/save/cancel in place, preserving their copy
  identity, priority, other defaults and unrelated template metadata. The panel
  remains mounted on `ContractTemplateDetail`; it was extracted to
  `TemplateDefaultDiscountsPanel.tsx` for behavioral component coverage.
- `Invoice.getInvoiceCharges` now returns canonical line IDs and adjustment
  provenance. Previously `ManualInvoices` fetched rows without those fields,
  so its permanent-change link and early overlap warning could not work.
  Adjustment dates are returned as date-only strings for the overlap predicate.
- `invoiceChargeLineage.ts` resolves both detail-backed generated charges and
  detail-free companion true-ups through their revision ledger, with tenant
  equality and text/UUID compatibility. The invoice reader, automatic discount
  base loader and server overlap check share this resolver.
- Calculator saves derive line identity from the billed source rather than
  trusting optional request metadata. Omitting the line no longer bypasses
  overlap confirmation; ambiguous source lines are rejected.

| Requirement | Inspected implementation and behavioral coverage |
| --- | --- |
| Contract-wide standing terms | `discountActions.ts` assigns to `client_contract_id`; `contractInvoiceAdjustments.ts` selects the contract's positive eligible charges across lines. DB coverage verifies 405,000 minor units and exactly one -40,500 settlement on retry. |
| Independent template copies | Wizard calls `cloneTemplateDefaultDiscounts`; new UUIDs and the per-term copy ledger isolate client definitions. Existing DB coverage exercises independent copies and template-edit isolation. New panel tests verify in-place edits, cancellation and rejected saves. |
| Standing charges/credits | Positive recurring charges retain catalog-backed contract lines for tax/accounting classification. A fixed contract discount authors the recurring credit, using the existing evaluator. |
| One-time calculator | Empty initial units/source/date, source-derived service/rate/period, real quantity and signed prorated unit rate remain. DB coverage executes increases/decreases, edits/reload, decimal rounding, missing-line overlap rejection and explicit confirmation. The fetched rows now expose the line and contract used by the permanent-change link. |
| Companion contract | Read-only inspection of companion `558c78e26a` confirms its plan and writer use `contract_change`, revision/version provenance, half-open adjustment periods and source-per-invoice retries. The new DB test uses its detail-free ledger shape and verifies read projection, tenant isolation, unchanged already-prorated amount, one line-scoped discount on retry and overlap rejection. |
| Customer walkthrough | Template default → two independent client copies → one invoice settlement each → template edit isolation, then calculator save/reload and permanent-change link. Live execution and `SMOKE-ADJ-1` reseeding remain for the separate smoke step. |

Fresh focused checks:

- Evaluator, automatic-adjustment helper, invoice model, template editor and
  three wizard suites: **73 passed** across seven files.
- Invoice adjustment database suite: **41 passed**; migration suite: **5 passed**.
  Both ran serially against isolated `test_adj_implement_desk` on port 5472.
- Billing build passed. Focused lint returned **0 errors** (existing and test
  mock warnings remain). Translation validation/audits passed; **32 i18n tooling
  tests passed**. No locale additions were needed because the editor reuses
  existing translated action labels.
- Billing typecheck reports **11 baseline diagnostics**: six in unchanged
  `profitabilityReportActions.ts` and five in unchanged `packages/ui/src/editor`
  files. None are in changed files. Typecheck is not claimed green.

The fixes above establish implementation and automated evidence, not current-
revision live UI, PDF, portal or accounting-export acceptance. No board state,
companion working tree, application data or live smoke fixture was changed.

## Review first

Start with template default discounts, then create two client contracts and inspect
their independent Discounts tabs and invoice settlements. Next inspect the manual
calculator's source selection, dates, save/reload, overlap confirmation, and link
to the selected contract line.

The app server stayed stopped during this implementation step. Current-revision
browser smoke, PDF/portal/export checks, and `SMOKE-ADJ-1` reseeding remain for the
authorized smoke step. Automated coverage below is not live UI evidence.

## Implemented behavior

- Contract-wide discounts use client-contract ownership and include eligible
  charges across its lines. Templates copy independent definitions; edits to one
  contract or the template do not modify another contract's copy. Per-term copy
  identities make mixed-scope, line-only, and repeated copying idempotent.
- The client wizard preserves source template lines within each billing method,
  including repeated services. Copied line discounts remain restricted to their
  own charges. Fixed-fee allocation preserves the authored total. Bucket pools
  spanning ambiguous source lines return an error rather than attach arbitrarily.
- Drafts with standing terms use their Lines and Discounts tabs for edits. The
  wizard rejects a destructive rebuild before deleting assignments or terms.
- The calculator derives dates, service, rate, and attribution from billed detail
  rows, persists real quantities and signed prorated unit rates, and checks for
  unconfirmed overlapping companion adjustments within the invoice transaction.
  Decimal quantities and negative half-cent rounding use the existing invoice
  persistence rule. It never writes contract quantity history.
- Half-open discount eligibility includes the entire invoice-date day when legacy
  invoice rows have no detail periods. A discount starting at the exclusive end
  of a covered period is excluded.
- Attachment and copy-ledger migrations distribute tables before adding foreign
  keys on Citus. The attachment migration uses sequential modification mode for
  its reference-table foreign key. A forward migration repairs existing copy
  ledgers; tenant deletion includes the ledger before its parents.

## Verification on the takeover changes

| Check | Result |
| --- | --- |
| `contractInvoiceAdjustments.db.test.ts` | 40 passed: calculator add/edit/reload, decimal quantities, $3,900 + $150 and one $405 discount, independent copies, scoped settlement/retry, tax, lifecycle, and same-method source lines |
| `contractDiscountAssignmentsClientScopeMigration.integration.test.ts` | 5 passed: fresh creation, populated fanout, ownership, reruns, copy identities and cascades |
| `contractInvoiceAdjustments.test.ts` | 28 passed |
| Current-head rerun: `contractInvoiceAdjustments.test.ts`, `contractInvoiceAdjustments.db.test.ts`, `contractDiscountAssignmentsClientScopeMigration.integration.test.ts` | 28 + 40 + 5 passed, including fabricated companion overlap confirmation and migration copy idempotency |
| Current-head wizard guards: `contractWizardActionErrors.test.ts`, `contractWizardResume.test.tsx`, `contractWizardBucketPools.submission.test.tsx` | 21 passed |
| `contractLineAction.protectedHistory`, `contractLineWindow`, `contractWizardActionErrors`, `contractWizardResume`, `contractWizardBucketPools.submission` | 34 passed across 5 files |
| `contractInvoiceManualCredit` and `billingInvoiceGeneration_discounts` | 11 passed, including tax overrides and quantity-derived credits |
| Billing build | Passed on current head (`npm run build --workspace=@alga-psa/billing`) |
| Locale generation and validation | Passed on current head (`npm run test:i18n`); 0 untranslated strings, forbidden terms, structural errors, or new unwired components; pseudo-locales regenerated |
| Focused lint | 0 errors; existing warnings remain |
| Billing typecheck | Rechecked with 8 GB heap: 11 diagnostics, all in unchanged `profitabilityReportActions.ts` (6) and `packages/ui/src/editor/*` (5); none in changed files. A default-heap run first exhausted memory. |
| `git diff --check` | Passed |

The same-method wizard test was run against the parent wizard as a negative
control. It failed to create the contract with repeated services; the repaired
wizard creates separate lines and settles 10% of 10,000 plus 20% of 20,000 as
exactly two rows (-1,000 and -4,000), unchanged on reconciliation retry.

Tests use dedicated PostgreSQL databases on `127.0.0.1:5472`, including
`test_adj_takeover`, `test_adj_takeover_migration`, and
`test_adj_takeover_credit`. DB suites were run sequentially. Example:

```bash
cd server
TEST_DB_NAME=test_adj_takeover NODE_OPTIONS=--max-old-space-size=6144 \
  npx vitest run --config vitest.workspace-db.config.ts \
  ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts
```

## Citus verification

Executed actual migration modules in a scratch database in the `citus-test`
sandbox, using single-node shard placement. The previous attachment migration
failed with a local-to-distributed foreign-key error. The corrected migration
passed, followed by client ownership upgrade and rerun. Copy-ledger checks passed
for fresh creation, populated reruns, colocation with client contracts, upgrade
from a populated local table, and deletion cascades from both parent tables.
Scratch databases were removed and the port-forward was closed.

The reproducible harness is [verify-citus-migrations.cjs](verify-citus-migrations.cjs).
Run from the repository root with a sandbox coordinator port-forward:

```bash
CITUS_TEST_POD=<sandbox-coordinator-pod> CITUS_TEST_PORT=55483 \
  node docs/evidence/contract-invoice-adjustments-repair-2026-09-27/verify-citus-migrations.cjs
```

## Remaining integration checks

The local companion ref `50ce6d41f78a2ee4186779b5d05b447c7845a5ef` contains
`RecurringUnitSchedulePanel` and its earlier next-period-only policy, not the
new automatic mid-period writer. The supplied captain `contract_change` handoff
is the implementation target; fabricated source-linked rows are covered through
reconciliation and overlap confirmation. No companion branch was modified.
See [companion-handoff.md](../f6e7254b-contract-product-schedule/companion-handoff.md).

The live walkthrough must prove default discount authoring, independent copies,
exactly one settlement on each invoice, template-edit isolation, calculator
save/reload, permanent-change navigation, and customer-facing output on the
current revision. Keep portal/accounting and combined-branch true-up results
explicitly unverified until those checks run.
