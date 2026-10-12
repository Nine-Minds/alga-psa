# PR #3499 current-head handoff — 2026-10-11

**Status: BLOCKED for human review.** The implementation can be reviewed, but
the prior READY claim is withdrawn until repaired-HEAD browser acceptance is
captured. No app server was started or restarted for this work. An already
present review listener was not used as acceptance evidence; the older review
build and its prior `add21274560c861a2d277582a518ae940a131795` evidence do not
prove the merge result. The base conflict is resolved in this branch; portal
output, real app-to-Xero-simulator delivery, and current-HEAD browser acceptance
remain open.

## Review first

1. Review the merge-resolution changes in `packages/billing/src/actions/contractWizardActions.ts`.
   Both the currency-aware per-template-line wizard API and the source-line
   identity used by copied line discounts must survive. The two focused DB
   tests that exercise this path are named “keeps fixed and Fixed template
   sources separate through creation and settlement” and “keeps fixed and
   Hourly template sources separate through creation and settlement”.
2. Review the companion implementation in `seatRevisions.ts` and
   `reconcileContractChangeAdjustments.ts`. It owns recurring revision history
   and the single mid-period true-up writer. The invoice evaluator consumes
   its already-prorated settlement; it must not prorate it again.
3. Use the unbilled candidate below for the first current-HEAD browser
   walkthrough. Do not use the delivered QBO fixtures listed under
   `docs/evidence/b97eda7b-contract-invoice-adjustments/mitigation-2026-10-11/`.

## Fixture state and safe setup

An isolated unbilled automatic-generation candidate was prepared through the
supported client creation, contract wizard, recurring-period materialization,
due-work, and preview domain actions. No server was started. The
candidate is currently eligible for the September 1–October 1 service period,
with an October 1–November 1 arrears invoice window. The domain candidate says
`due` and `canGenerate: true`; baseline invoice query returned no invoices,
and the two matching period rows have no invoice or charge-detail claim.
Exact captured candidate and preview output is in
[`fixture-current-head.json`](./fixture-current-head.json).

| Record | Identifier / value |
| --- | --- |
| Tenant | `6d178771-ad9a-4d43-8809-83992745f8f9` |
| Client | `REVIEW-3499-UNBILLED-20261012-dcd6e36f` / `5ba78228-ace1-4990-b42f-30739458299a` |
| Template | `REVIEW-3499-MITIGATION-TWO-FIXED-LINES` / `566a5bd6-2435-4818-b147-60edf805adbd` |
| Contract | `REVIEW-3499-UNBILLED-20261012-dcd6e36f-CONTRACT` / `a5e37780-a9ba-4a35-a643-2233c25a5d0b` |
| Client-contract assignment | `4921ceb2-72f5-4f0a-afdc-da256e932c41` (active, starts 2026-09-01) |
| Managed Workstation line | `dd5c2b59-a8b8-430d-a3ca-1bcc126dd997`; quantity 1 × A$200 = 20000 minor units |
| Cabling line | `85923f68-0cfa-4a94-83c5-3eadd740978d`; quantity 1 × A$120 = 12000 minor units |
| Copied 12% contract discount | `c23f8952-378a-4de5-80d1-3f032396fec6` |
| Copied fixed A$25 contract discount | `f100f50c-4f9f-4d3a-ba5f-6d607ef3e605` |
| Copied 10% Cabling line discount | `9365c6cc-c681-483c-bb96-63ce6dea0271`, targeting Cabling line above |
| Eligible candidate | `invoice-candidate:5ba78228-ace1-4990-b42f-30739458299a:2026-10-01:2026-11-01` |
| Unclaimed period rows | `fe039803-e891-4faf-89d0-7b3ec84af1c5` (Cabling), `dea8e371-e639-4650-87a3-87fa8ce42f28` (Managed Workstation); both `invoice_id` and `invoice_charge_detail_id` are null |
| Preview before tax | Gross 32000; 12% contract −3840; Cabling 10% −1200; fixed A$25 −2500; subtotal A$244.60 / 24460 minor units; preview tax 0; total 24460 |

The retained Client B copy is billed history: `INV-000042` /
`cc1b7023-0c3a-4f7d-b271-d78eadb9c8c2`. Preserve it; do not regenerate,
reverse, or clean it up. The fresh candidate above is the one to use for the
first current-HEAD browser walkthrough. Navigation is **Billing → Invoicing →
Automatic Invoices**. Select the candidate key above and compare the preview
with the recorded amounts before any generation. Leave it unbilled until a
reviewer explicitly performs the walkthrough.

The fixture was created through supported client creation, contract wizard,
recurring-period materialization, due-work, and preview domain actions. The
retained Client B copy `INV-000042` /
`cc1b7023-0c3a-4f7d-b271-d78eadb9c8c2` is separate billed history and must
remain untouched. Its prior subtotal is not evidence for this fixture. The
new unbilled candidate preview is gross 32000, discounts −3840, −1200, and
−2500, subtotal 24460 before tax.

The previously observed Automatic Invoices preview included a `−A$32` line
discount because the old preview treated that copied term as invoice-wide.
That screenshot is a defect reproduction only. The current-head expected
line-scope value is `−A$12` on Cabling alone.

### Repeatable read-only fixture audit and baseline queries

The fixture already exists in the review database. This committed audit script
does not create, update, generate, or clean up any records. It loads the
worktree's `.env.localtest` connection settings (or accepts `DATABASE_URL`),
and requires the exact expected database name:

```sh
PR3499_FIXTURE_DB_NAME=server npx tsx scripts/audit-pr3499-unbilled-fixture.ts
```

To use a separate review database, set `DATABASE_URL` and its matching
`PR3499_FIXTURE_DB_NAME`. The audit opens a read-only transaction and asserts
the exact client/assignment, both copied lines, all three independent discount
copies, both still-unclaimed period rows for Sep 1–Oct 1 service and the Oct
1–Nov 1 invoice window, and that no invoice has claimed that window. It prints
the period rows for reviewer inspection.
The read-only supported due-work/preview result and all source rows are retained
in [`fixture-current-head.json`](./fixture-current-head.json). To refresh the
preview, use Billing → Invoicing → Automatic Invoices and select the candidate
key above; leave it unbilled. Do not re-run an unavailable seed harness or
create a second copy of this fixture.

Run these against the review DB before generation and retain the output. They
must return the exact template, assignment, copied terms and line composition;
there must be no invoice/charge for the eligible service period.

```sql
-- Template source lines and source amounts.
SELECT ctl.template_line_id, ctl.template_line_name, ctl.line_type,
       ctl.billing_frequency, ctl.display_order,
       s.service_name, tls.quantity, tls.custom_rate
FROM contract_template_lines ctl
LEFT JOIN contract_template_line_services tls
  ON tls.tenant = ctl.tenant AND tls.template_line_id = ctl.template_line_id
LEFT JOIN service_catalog s
  ON s.tenant = tls.tenant AND s.service_id = tls.service_id
WHERE ctl.tenant = '6d178771-ad9a-4d43-8809-83992745f8f9'
  AND ctl.template_id = '566a5bd6-2435-4818-b147-60edf805adbd'
ORDER BY ctl.display_order, s.service_name;

-- Assignment-owned discount copies and their persisted scopes/targets.
SELECT a.assignment_id, a.client_contract_id, d.discount_id, d.discount_name,
       d.discount_type, d.value, d.scope, d.scope_service_id,
       cld.contract_line_id, d.start_date, d.end_date, d.is_active
FROM contract_discount_assignments a
JOIN discounts d
  ON d.tenant = a.tenant AND d.discount_id = a.discount_id
LEFT JOIN contract_line_discounts cld
  ON cld.tenant = a.tenant AND cld.client_contract_id = a.client_contract_id
 AND cld.discount_id = a.discount_id
WHERE a.tenant = '6d178771-ad9a-4d43-8809-83992745f8f9'
  AND a.client_contract_id = '4921ceb2-72f5-4f0a-afdc-da256e932c41'
ORDER BY d.priority, d.discount_name;

-- No invoice or charge has already claimed the eligible service period.
SELECT i.invoice_id, i.invoice_number, i.status, d.item_id,
       d.service_period_start, d.service_period_end,
       c.adjustment_source_kind, c.adjustment_source_id
FROM invoices i
LEFT JOIN invoice_charges c
  ON c.tenant = i.tenant AND c.invoice_id = i.invoice_id
LEFT JOIN invoice_charge_details d
  ON d.tenant = c.tenant AND d.item_id = c.item_id
WHERE i.tenant = '6d178771-ad9a-4d43-8809-83992745f8f9'
  AND i.client_contract_id = '4921ceb2-72f5-4f0a-afdc-da256e932c41'
  AND i.invoice_date >= DATE '2026-10-01'
  AND i.invoice_date < DATE '2026-12-01'
ORDER BY i.invoice_date, i.invoice_number;

-- The two eligible period records are due and remain unclaimed.
SELECT record_id, obligation_id, period_key, lifecycle_state,
       invoice_window_start, invoice_window_end, invoice_id,
       invoice_charge_detail_id
FROM recurring_service_periods
WHERE tenant = '6d178771-ad9a-4d43-8809-83992745f8f9'
  AND record_id IN ('fe039803-e891-4faf-89d0-7b3ec84af1c5',
                    'dea8e371-e639-4650-87a3-87fa8ce42f28')
ORDER BY record_id;
```

### Validation record

Latest post-fix validation was run on commit
`68ed4bfb7f5bba5cb2b3f2533599a3ba8ac36693` for the existing PR #3499 branch.
Exact commands and results:

| Command | Result |
| --- | --- |
| `cd server && TMPDIR="$PWD/.vitest-tmp-review" npx vitest run --config vitest.config.ts src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts --coverage.enabled=false --maxWorkers=1 --pool=threads --no-file-parallelism --reporter=dot` | 121/121 pass, including source increases/decreases, repeat-generation stability, manual preservation, and validating/delivered export guards. |
| `cd server && TMPDIR="$PWD/.vitest-tmp-review" npx vitest run --config vitest.config.ts src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts -t "carries a pending adjustment past a finalized invoice" --coverage.enabled=false --maxWorkers=1 --pool=threads --no-file-parallelism --reporter=dot` | 1/1 pass; preview, saved −1,548 discount, 433,936 subtotal, and repeat recalculation agree. |
| `cd server && TMPDIR="$PWD/.vitest-tmp-review" npx vitest run --config vitest.config.ts ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts --coverage.enabled=false --maxWorkers=1 --pool=threads --no-file-parallelism --reporter=dot` | 64/64 pass, including canonical 390000 + 15000 → −40500 = 364500 first-save, reload stability, tax allocations, manual scope, and discount copies. |
| `cd packages/billing && TMPDIR="$PWD/server/.vitest-tmp-review" npx vitest run src/lib/billing/compute/invoiceAutomaticAdjustments.test.ts --coverage.enabled=false --maxWorkers=1 --pool=threads --no-file-parallelism --reporter=dot` | 4/4 pass: expired percentage/fixed periods, disjoint coverage, deterministic repeat evaluation, and unversioned legacy compatibility. |
| `PR3499_FIXTURE_DB_NAME=server npx tsx scripts/audit-pr3499-unbilled-fixture.ts` | Pass in database `server`; audit ran in a read-only transaction and confirmed both invoice-window rows remain unclaimed. |
| `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p server/tsconfig.json` | Pass. |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck --workspace=@alga-psa/billing` | Pass. |
| `npm run build --workspace=@alga-psa/billing` | Pass (`tsup`, all eight entries). |
| `cd server && TMPDIR="$PWD/.pr3499-build-tmp" NEXT_DIST_DIR=.next-pr3499-source-period-20261012-12g NODE_OPTIONS=--max-old-space-size=12288 npm run build` | Pass; compiled, generated 74/74 static pages, and collected traces. Existing webpack warnings include scheduling star-export conflicts, dynamic dependencies, Edge Runtime `process.cwd()`, and dynamic `headers()` in `/_global-error`. |
| `npx eslint packages/billing/src/lib/billing/compute/contractInvoiceAdjustments.ts packages/billing/src/lib/billing/compute/invoiceAutomaticAdjustments.test.ts packages/billing/src/services/invoiceAutomaticAdjustments.ts server/src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts scripts/audit-pr3499-unbilled-fixture.ts` | 0 errors, 98 warnings, mostly existing `any`, non-null assertion, and unused-variable warnings in the billing service and large infrastructure test. |

The first full billing-settlement DB run after adding charge-level eligibility
had 9 failed assertions (55 passed): explicit date-bounded discounts resolved
to zero when test charges had no persisted detail periods. The repair assigns
periodless ordinary charges their ordinary invoice coverage; if an invoice
carries a true-up and has no ordinary detail coverage, it uses the invoice-date
day instead of the widened min/max true-up window. The rerun above passed 64/64.

The first parallel server and billing typecheck attempt exited with code 134
under Node's default 4 GiB heap (`Reached heap limit` / `Ineffective
mark-compacts near heap limit`). Sequential runs passed with 12 GiB for the
server and 8 GiB for billing. The latest production build exited 0 after 12
minutes; the earlier 8 GiB build's OOM described below is historical and was
not repeated.

Earlier verification from the preceding repair commit `edeb8c0f2b8e16990d7e4dc35a743051320464fb`:

| Command | Result |
| --- | --- |
| `cd server && TMPDIR="$PWD/.vitest-tmp-review" npx vitest run --config vitest.config.ts src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts --coverage.enabled=false --maxWorkers=1 --pool=threads --no-file-parallelism --reporter=dot` | 121/121 pass, including source increases and decreases, canonical revision identity, discount ordering, repeat generation, manual preservation, contract-only discount scope, and validating/delivered export guards. |
| `cd server && TMPDIR="$PWD/.vitest-tmp-review" npx vitest run --config vitest.config.ts ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts --coverage.enabled=false --maxWorkers=1 --pool=threads --no-file-parallelism --reporter=dot` | 64/64 pass, including the canonical 390000 + 15000 → −40500 = 364500 first-save, later-charge/reload stability, and prior QBO allocation-tax cases. |
| Same DB test command with `-t 'round-trips fixed allocation tax'` | 4/4 pass (QBO and Xero, legacy and current lineage); prior 462-versus-418 QBO failures do not reproduce on this HEAD. The current upstream base `d6dc22c27363eb6a3b52757e8008687b763121d7` does not contain this test file, so it is not a directly comparable base test. |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p server/tsconfig.json` | Pass. |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck --workspace=@alga-psa/billing` | Pass. |
| `npm run build --workspace=@alga-psa/billing` | Pass (`tsup`, all eight entries). |
| `npm run i18n:audit` | Pass; all eight locales have 34,712 keys and zero untranslated/forbidden/missing entries. |
| `TMPDIR="$PWD/server/.vitest-tmp-review" npm run test:i18n` | Pass, 50/50. The same command without private `TMPDIR` failed 5 cases before assertions while writing temporary files (`Unknown system error -122`); the focused Vitest suites above passed with the private directory. |
| `npx eslint packages/billing/src/lib/billing/reconcileContractChangeAdjustments.ts packages/billing/src/services/invoiceAutomaticAdjustments.ts server/src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts` | 0 errors, 102 warnings (existing `any` and non-null-assertion warnings in the large test file). |
| `cd server && NEXT_DIST_DIR=.next-pr3499-production-20261012-12g NODE_OPTIONS=--max-old-space-size=12288 npm run build` | Pass. Enterprise production build completed compilation, 74 static pages, and build trace collection. Next emitted existing warnings about Edge Runtime `process.cwd()` use and dynamic `headers()` use in `/_global-error`; the build exited 0. |

At the time of the `-122` failure, `/tmp` was 25/31 GiB used with 6.1 GiB available and 42% inode use; the workspace filesystem had 32 GiB available. `quota -s` is not installed. No shared or other review artifacts were deleted. The successful reruns used the worktree-private `server/.vitest-tmp-review` directory. Production builds used distinct `NEXT_DIST_DIR` values so they did not overwrite the pre-existing review builds.

The first production build attempt used `NEXT_DIST_DIR=.next-pr3499-production-20261012` and an 8 GiB heap. It exited 134 after about 4m20s with `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` during SWC compilation. The successful 12 GiB retry used its own output directory; both generated directories and logs were preserved.

### Cleanup boundary

Keep the new client, contract, assignment, two copied lines, three copied
discounts, recurring period records, and any later reviewer-created invoice
as an explicitly owned walkthrough fixture until reviewer sign-off. If
cleanup is later requested, use supported domain/UI actions and remove only
the new client ID `5ba78228-ace1-4990-b42f-30739458299a` and its associated
contract data after confirming the invoice is still absent or is an editable
draft. Do not delete the source template or any Client B record. Never unlock,
reset, delete, or re-export delivered QBO review history; in particular
preserve invoice
`5a1e0000-0000-4000-8000-202610079004`, batch
`3ac31e06-9479-4f5d-9c73-170a880d80d9`, and simulator invoice `invoice-21`.
Keep shared credentials and shared fixtures unchanged.

## Remaining current-HEAD acceptance

- **Client portal:** sign in as a Client B portal contact and compare its
  invoice line/discount/tax output with the persisted invoice and MSP preview.
- **Xero simulator:** from the real application UI, execute a fresh isolated
  Xero export. Capture the application request, simulator response, persisted
  settlement and export lock. Do not reuse or mutate delivered QBO history.
- **Companion true-up:** through the real recurring-unit schedule workflow,
  create separate quantity increase and decrease revisions with mid-period
  opt-in. Verify canonical revision identity/version, half-open dates,
  signed already-prorated amount, reason, earliest eligible editable invoice,
  discount ordering, one settlement per revision, and repeat-generation
  stability. Do not fabricate ledger source rows as acceptance.
- **Browser freshness:** run all above against an application built from the
  repaired commit. We did not start or restart a server; any preexisting review
  service is not current-head evidence.
