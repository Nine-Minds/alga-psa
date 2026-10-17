# PR #3499 repair handoff — validated application source `5bf290f894`

**Status: BLOCKED for human review.** The merged implementation source at
`5bf290f894fd29e2243fd23feee717ebb8340e9b` was revalidated. The PR/local/upstream
head may include subsequent docs-only handoff commits; these do not change
application source. The implementation source includes current
`origin/main` (`aa4e1e5db3e4834ba1877b53dbc178819d975cd2`) with no merge
conflicts; GitHub reports the PR mergeable, while the merge state is blocked by
required checks. At the latest exact-head CI query, 44 checks passed, one was
skipped, 24 were in progress, and two failed. The Workspace database test job
failed during `npm ci` with an npm registry `ECONNRESET` before tests ran; its
paired execution-complete check failed downstream because test evidence was
absent. This is infrastructure failure, not a test result. Pending checks are
not passes; recheck CI before review.

Current-source validation passed: billing and server typechecks, billing
package build, settlement DB 66/66, companion quantity/history DB 121/121,
Xero integration 5/5 (mocked transport), expanded-save/percentage UI 20/20,
translation validation, and an isolated enterprise production build (74/74
static pages, traces collected). A read-only audit confirmed the owned
unbilled fixture remains available. No invoice was generated, no delivered or
locked history was changed, and no app server was started or restarted.

Earlier browser evidence, including the `add21274560c861a2d277582a518ae940a131795`
smoke, is historical and does not establish acceptance at `5bf290f894`. The
current-build browser walkthrough, portal parity, application-to-Xero-simulator
delivery, and companion schedule-writer acceptance remain open. The served
guide is [available here](http://100.109.101.64:23186/); its status is
**BLOCKED** until those live gates pass.

## Production reconciliation regression (2026-10-13)

Commit `2778973d28143462f3107eb7de00102065ac014b` replaces the copied
recalculation helper in the consolidated-period regression with
`BillingEngine.recalculateInvoice`. It starts with pending canonical companion
ledger entries, so the production path must materialize signed true-ups before
reconciling configured discounts. Both fixed and percentage cases run that path
before posting and twice after a manual credit edit.

The fixture has January/February allocations of 10,000/20,000 minor units,
a January-bound positive true-up of 2,000, and a February credit of −3,000.
The January-only discount base stays 12,000. Tax starts at zero and the actual
tax distribution pipeline calculates 300 on the taxable consolidated parent,
using a deterministic 1% tax calculator. The true-up service is explicitly
non-taxable. Canonical detail taxes are 100/200. A manual credit edit from
−400 to −500 posts one −100 principal adjustment; repeating production
recalculation adds no posting and retains manual, discount, and true-up IDs.
This is database integration evidence, not browser acceptance of the schedule
writer.

Validation:

- Full settlement suite: **66/66 passed**, exit 0, on the committed test source.
  Command from `server`: `TEST_DB_NAME=test_pr3499_takeover DB_HOST=127.0.0.1
  DB_PORT=5472 npx vitest run --config .vitest-pr3499-takeover.config.ts
  ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts
  --maxWorkers=1 --pool=forks --no-file-parallelism --reporter=dot`.
  The temporary config inherited `vitest.config.ts`, disabled its nested
  projects, and set hook/test timeouts to 600,000/120,000 ms. The ordinary
  config's nested project ignored the CLI hook override and timed out during
  migration setup under host I/O pressure; no assertion ran on that attempt.
- Full Xero integration file: **5/5 passed**, exit 0, using the same temporary
  config, `TEST_DB_NAME=test_pr3499_takeover_xero`, and
  `src/test/integration/accounting/xeroLiveExport.integration.test.ts --retry=0`.
  T020 reloads durable per-line validation errors, asserts zero provider calls,
  and checks stale-owner rejection; successful delivery cases also pass.
  Provider transport is mocked in this suite, not an app-to-simulator run.
- Billing package build: **exit 0**. No application server was started.
- Inherited application HEAD `24171dda2cf6433d17f1de03d71f9b8c98c6cc6f`:
  TypeScript workflow `38369225414` passed; Citus migration/cleanup passed in
  workflow `38369226307`. This takeover changes tests and documentation only.
- Read-only retained fixture audit: **exit 0**. Both September service-period
  rows remain unclaimed; their candidate invoice window is October 1–November 1.
  Recalculate the historical 24,460 preview before the live walkthrough.

The guide remains **BLOCKED** for current-build browser, portal, app-to-Xero,
and companion schedule-writer acceptance. Existing delivered history was not
changed. Prior results below remain dated evidence, not new acceptance claims.

## Takeover validation (2026-10-12)

Review `contractInvoiceAdjustments.ts` and `invoiceAutomaticAdjustments.ts`
first. Consolidated fixed charges now carry their exact detail amounts with
half-open coverage. A January-only discount on a parent containing January
10,000 and February 20,000 uses a 10,000 base. Its fixed discount cannot consume
February capacity. Preview and persisted reconciliation use the same portions;
settlement allocations retain canonical parent IDs. Invalid allocation sums
reject evaluation rather than silently allocating the full parent.

The prior carried-true-up regression remains valid: January 10% discounts only
15,484 by 1,548, excluding February's 420,000. The new percentage/fixed database
cases additionally cover a consolidated parent spanning both periods and
repeat reconciliation with stable settlement identity.

CI repairs preserve current schema and financial semantics:

- Protected-history checks use canonical `obligation_id`; the merged main
  migration removes the old `obligation_type` column.
- Manual-invoice tests assert signed ledger deltas and total posted principal.
  Negative standing contract rates remain prohibited; manual credits remain
  covered by the existing behavior suites.
- Citus attachment creation distributes a local `discounts` parent before
  adding its distributed child foreign key. Populated rows survive reruns.
- The Temporal provisioning test mocks the miscellaneous-service initializer
  that tenant creation now invokes.

Fresh takeover results:

| Check | Result |
| --- | --- |
| Billing unit suite | 369 files, 2,017 tests pass |
| Shared billing compute tests | 134 pass, including 5 source-period tests |
| Contract adjustment DB suite | 66 pass |
| Companion quantity semantics + manual invoice DB suites | 137 pass |
| Protected-history, subtotal and assignment migration DB suites | 15 pass |
| Temporal email-settings provisioning test, `TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP=1` | 2 pass |
| Billing and server typechecks | Pass |
| Billing package build | Pass |
| Changed-file ESLint | 0 errors; existing warnings remain |
| Combined CE/EE Citus migration chain | All 1,172 migrations recorded in an isolated Citus 12.1 database |
| Populated local-parent Citus regression | Pass: distribution, colocation, identity preservation, rerun and FK cascade |
| Unbilled fixture audit | Pass; both periods remain unclaimed |

That paragraph recorded an earlier in-progress build and is superseded by the
completed build on source revision `5bf290f894` below. The successful isolated
build used one worker and a 12 GiB heap, generated all 74 static pages, and
collected traces. It was a build only; no app server was started or restarted.

Run the committed fixture audit from the repository root:

```sh
PR3499_FIXTURE_DB_NAME=server node --import tsx scripts/audit-pr3499-unbilled-fixture.ts
```

Use `node --import tsx` here: the `tsx` CLI's IPC socket can exceed the Unix
socket path limit under this worktree's private temporary directory.

The committed Citus regression requires an empty disposable database named
`pr3499_citus_discounts`, the Citus extension, and a coordinator configured to
host shards. It refuses other database names or a nonempty public schema and
rolls back all fixture tables and rows:

```sh
PR3499_CITUS_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/pr3499_citus_discounts' \
  node scripts/check-pr3499-citus-discount-migration.cjs
```

The takeover's disposable Citus container was removed after validation.
Existing generated build artifacts and all shared review fixtures were
preserved. The board fact command timed out; the schema and period-allocation
facts above are retained here for the next step.

Current-head browser, portal, app-to-Xero, and source-workflow acceptance remain
BLOCKED. The previously observed production listener's revision stamp was
`add21274560c861a2d277582a518ae940a131795+da39a3ee5e6b`; that historical output
cannot validate this repair. No listener was used as current-head proof.

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
PR3499_FIXTURE_DB_NAME=server node --import tsx scripts/audit-pr3499-unbilled-fixture.ts
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
| `PR3499_FIXTURE_DB_NAME=server node --import tsx scripts/audit-pr3499-unbilled-fixture.ts` | Pass in database `server`; audit ran in a read-only transaction and confirmed both invoice-window rows remain unclaimed. |
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

### Repair validation on 2026-10-13

Implementation fixes are committed as `428c6261f7f186076129e89e513cc3d1821f49ac`
and the CI test-fixture follow-up as `7dc4221ef1aeca6435dee9f5430de261da24e481`.
The exact local HEAD at validation was `7dc4221ef1aeca6435dee9f5430de261da24e481`.
No application server was started. Commands ran against the isolated PostgreSQL
database `test_pr3499_aa75047` at `127.0.0.1:5472` unless noted.

| Command / check | Result |
| --- | --- |
| `cd server && TMPDIR="$PWD/.vitest-tmp-review" TEST_DB_NAME=test_pr3499_aa75047 DB_HOST=127.0.0.1 DB_PORT=5472 npx vitest run --config vitest.config.ts src/test/integration/accounting/xeroLiveExport.integration.test.ts -t 'T020: missing net_amount' --coverage.enabled=false --maxWorkers=1 --pool=threads --no-file-parallelism --retry=0 --reporter=dot` | Exit 0, 1 passed / 4 skipped. The consolidated parent with null `net_amount` records per-line `missing_net_amount`; Xero provider mock remains uncalled. |
| `cd server && TMPDIR="$PWD/.vitest-tmp-review" TEST_DB_NAME=test_pr3499_aa75047 DB_HOST=127.0.0.1 DB_PORT=5472 npx vitest run --config vitest.config.ts src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts --coverage.enabled=false --maxWorkers=1 --pool=threads --no-file-parallelism --reporter=dot` | Exit 0, 121/121 pass. |
| `cd server && TMPDIR="$PWD/.vitest-tmp-review" TEST_DB_NAME=test_pr3499_aa75047 DB_HOST=127.0.0.1 DB_PORT=5472 npx vitest run --config .vitest-pr3499-review.config.ts ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts --coverage.enabled=false --maxWorkers=1 --pool=threads --no-file-parallelism --reporter=dot` | Exit 0, 66/66 pass using a temporary Vitest config (600s hook / 120s test timeout; config removed after run). Consolidated period cases assert preview and repeated settlement, tax/totals, canonical allocations, stable invoice ledger posting, manual-line preservation, and carried positive/negative true-ups at half-open boundaries. |
| Four focused manual/finalization/void/currency adapter unit files on HEAD `7dc4221ef1aeca6435dee9f5430de261da24e481` | Exit 0, 24/24 pass. This addresses the failed unit shards reported by run `38348261029` on old HEAD `aa75047e8a47780c6bde57100cca8fd4034a1f1c`. |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck --workspace=@alga-psa/billing` | Exit 0. |
| `npm run build --workspace=@alga-psa/billing` | Exit 0; all eight tsup entries built. |
| `cd server && NEXT_DIST_DIR=.next-pr3499-repair-7dc-20261013 NEXT_BUILD_CPUS=1 NODE_OPTIONS=--max-old-space-size=12288 npm run build` | Exit 0; production build compiled, generated 74 static pages, and collected traces. Existing warnings include middleware naming, webpack cache size, and dynamic `headers()` use in `/_global-error`. It skipped type validation per project config. |
| `cd server && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json` | Exit 2 due parser errors in ignored generated `server/.next-dev/dev/types/routes.d.ts`, imported by `next-env.d.ts`; that generated file contains truncated route text around line 761. It was not edited or removed to preserve local artifacts. Billing package typecheck passed separately. |
| `git fetch origin main`; `gh pr view 3499` | Fetch succeeded; current base `450070437d770ba651a63b4318a72a9de4e8fc7c` is an ancestor of HEAD and matches the PR base. PR head still reported old `aa75047`; two local commits were ahead. The old run's remaining failures include unit shards, integration shard 4, Citus migration, and browser/fresh-install jobs. Local focused tests address unit and T020 failures; rollback now deletes tenant-owned `service_catalog` before tenant deletion to address the Citus FK failure. New Citus CI confirmation and new-HEAD CI are pending push. |
| `PR3499_FIXTURE_DB_NAME=server node --import tsx scripts/audit-pr3499-unbilled-fixture.ts` | Exit 0, read-only audit confirms the owned client/assignment and both period rows remain unclaimed. Recorded preview is historical (24,460 minor units); recalculate before walkthrough. |

The branch is not human-review-ready. Keep this guide **BLOCKED** until CI and
the authorized browser, portal, real app-to-Xero, and combined companion
acceptance are demonstrated. Those acceptance paths need an application server;
this implementation step must leave it stopped.

### Follow-up durable-error and posted-tax regression

Follow-up commits `c760c2f61235aa68aae601a16c24e5e4da86c42c` and
`8423482e2ca14e83182d830fdb110f8bdc2dcb78` address review findings. On exact
source HEAD `8423482e2ca14e83182d830fdb110f8bdc2dcb78`:

| Command / check | Result |
| --- | --- |
| T020 using `--pool=forks` on `test_pr3499_aa75047` | Exit 0, 1 passed / 4 skipped. It reloads `accounting_export_errors` after failed execution, asserts `missing_net_amount` on the exact line, verifies zero Xero provider calls, then proves a stale attempt cannot change a replacement execution owner or append stale errors. |
| Targeted settlement DB test with `.vitest-pr3499-review.config.ts` (600s hook timeout) and `--pool=forks` | Exit 0, 2 passed / 64 skipped. Both percentage and fixed cases execute `calculateAndDistributeTax` (calculated total 320), update totals, record generation principal, then repeat posted recalculation after a −100 manual-credit edit. They assert stable discount settlement identity, canonical detail allocations/tax, one `invoice_adjustment` of −100, no posting on the repeat, and manual-line preservation. |
| Fresh Citus cleanup CI on preceding repair HEAD `6763d79dbacfe2672aa3c6afb62ca43184074c40` | `citus / Combined migrations on single-node Citus` passed. The exact current HEAD `8423482e2ca14e83182d830fdb110f8bdc2dcb78` has a new production regression CI run in progress; its Citus job is pending. |
| Server `tsc --noEmit -p tsconfig.json` using the successful production-build route types referenced by `next-env.d.ts` | Attempted on the local host but interrupted with exit 130 after prolonged filesystem I/O stalls; it emitted no TypeScript diagnostic. The exact-HEAD GitHub TypeScript workflow is in progress. |

An earlier settlement retry exposed PostgreSQL numeric values as strings in
test assertions; the test now normalizes numeric database columns before
comparing. The default 120s migration hook also timed out under host pressure,
so the passing targeted run used the longer temporary config; that config is
removed after execution. Keep the review guide **BLOCKED** while exact-HEAD CI
and authorized live browser, portal, and app-to-Xero acceptance remain open.

### Review continuation from `aa75047e8a`

The owned unbilled walkthrough fixture was re-audited read-only on 2026-10-13
with `PR3499_FIXTURE_DB_NAME=server node --import tsx
scripts/audit-pr3499-unbilled-fixture.ts`. It remains unbilled: client
`5ba78228-ace1-4990-b42f-30739458299a`, assignment
`4921ceb2-72f5-4f0a-afdc-da256e932c41`, and recurring period rows
`fe039803-e891-4faf-89d0-7b3ec84af1c5` and
`dea8e371-e639-4650-87d3-87fa8ce42f28` have `invoice_id=null` and
`invoice_charge_detail_id=null`. The audit database is `server`; the fixture
client is `REVIEW-3499-UNBILLED-20261012-dcd6e36f`. Historical preview value
is 24,460 minor units; recalculate on the repaired HEAD before walkthrough.
Cleanup ownership and restrictions remain as above.

The control, QBO, and Xero simulator listeners were observed on ports 29500,
24020, and 24060. Listener presence is not an acceptance run. No application
server was started, and portal/browser/app-to-Xero proof remains pending.

- **Status: BLOCKED.** Do not treat historical READY wording as current
  acceptance. Consolidated-period tax/totals/ledger DB regression, current
  companion and settlement DB suites, production build, and latest CI reruns
  must be recorded against the exact repaired HEAD before implementation
  evidence can be reviewed. Portal, real Xero, and combined companion acceptance
  still require the authorized smoke step.

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

### Current builder follow-up — 2026-10-13

The local fixture audit passed again against `server`; both September 1–October
1 period rows remain `generated` with null `invoice_id` and
`invoice_charge_detail_id`, and the October 1–November 1 candidate remains
unclaimed. The committed production recalculation DB suite was rerun from this
checkout: 66/66 passed. Billing package typecheck and build also passed.

The current PR workflow `38374648373` completed with all non-browser required
checks passing. Both community and enterprise production-browser jobs failed on
the same stale E2E locator in `e2e-tests/tests/invoice-generation.spec.ts`: it
selected `#service-select`, while the line editor correctly renders unique
`service-select-{item_id}` IDs. The test now selects the rendered ID prefix;
rerun the browser workflow after this test-only repair is pushed. This was an
E2E selector failure, not evidence that the invoice editor control was absent.
The enterprise and community browser runs otherwise reached that same test
failure. Do not mark browser acceptance complete from this repair.

On this checkout, the fresh enterprise production build completed with exit 0
using isolated output `server/.next-pr3499-builder-20261013`, one build worker
and a 12 GiB Node heap. It compiled, generated all 74 static pages, and
collected traces. The app source is identical in commit `082e9d8d38`; that
commit changes only this E2E locator and the handoff. Next reported existing
warnings for conflicting scheduling star exports, dynamic dependencies,
Edge Runtime `process.cwd()`, and dynamic `headers()` in `/_global-error`.

Fresh local results on the merged app source: contract adjustment settlement
DB suite 66/66; companion quantity semantics DB suite 121/121; complete Xero
integration file 5/5; billing package typecheck; billing package build. The
companion suite took 573.99 seconds under host pressure. One earlier Xero retry
was terminated with signal 15 before tests began; the subsequent full retry
passed all five tests. Companion automation coverage is green, while real
schedule-writer acceptance still requires the blocked live walkthrough.

The new PR CI run for `082e9d8d38` is pending. The preceding exact-head run
`38374648373` passed all non-browser checks; its community and enterprise
browser jobs both reached the manual invoice E2E and failed on the stale
`#service-select` locator. Commit `082e9d8d38` initially switched to the ID
prefix, but review found it also matches CustomSelect's wrapper. The follow-up
repair targets `button[role="combobox"][id^="service-select-"]` and asserts
exactly one match before clicking. The app server was not started to exercise
that browser test locally; verify both browser editions on the new head before
marking browser acceptance complete.

**Status remains BLOCKED** for current-build browser walkthrough, portal
comparison, real app-to-Xero-simulator delivery and companion schedule-writer
acceptance. The app server was not started or restarted.

### Selector review follow-up — 2026-10-13

Commit `c1b61d9384aafddeda3c3337c2e84480ddf3c8da` repairs the locator by
targeting `button[role="combobox"][id^="service-select-"]` and asserting one
match before clicking. It is pushed to PR #3499. The first CI-only E2E run
`38394210913` built/exported the enterprise image successfully; the community
image build failed during `npm install --include=optional` with `ECONNRESET`.
Both production browser matrix jobs then stopped at the build-result gate, so
neither browser edition exercised the repaired locator. The failed jobs were
rerun with `gh run rerun --failed`; as of this update the community image build
is still in progress. No local app server was started. Record both browser
edition results after that rerun reaches the production E2E jobs. Status remains
**BLOCKED** for portal, app-to-Xero, and companion schedule-writer acceptance.

### Exact-head verification — 2026-10-13 (`95aafcdd15e983d237d48ab15c4c0f69bd7d106e`)

The current checkout was audited before changes. Its only source/test change
after `4e7f457300` is the E2E service-combobox locator in
`e2e-tests/tests/invoice-generation.spec.ts`; the remaining commit adds this
evidence update. No invoice implementation change was needed in this pass.

Fresh local verification on this exact HEAD:

- Owned unbilled fixture audit passed against database `server` using
  `PR3499_FIXTURE_DB_NAME=server node --import tsx
  scripts/audit-pr3499-unbilled-fixture.ts`. Client
  `5ba78228-ace1-4990-b42f-30739458299a`, assignment
  `4921ceb2-72f5-4f0a-afdc-da256e932c41`; both September periods remain
  generated and unclaimed, with invoice windows 2026-10-01 through 2026-11-01.
  No retained or delivered invoice was changed. The isolated fixture and prior
  preview are documented in `fixture-current-head.json`; recalculate before
  walkthrough because the 24,460-minor-unit preview is historical.
- Contract adjustment settlement DB suite: **66/66 passed**, exit 0, using the
  isolated database `test_pr3499_95aafcdd15` and a temporary Vitest config that
  disables the repository's nested environment projects and extends DB setup
  timeout.
- Companion quantity semantics DB suite: **121/121 passed**, exit 0, using
  `test_pr3499_95aafcdd15_companion`. It exercises canonical companion source
  revisions, increases/decreases, repeat generation, manual-line preservation,
  and lifecycle/export protections. This is database evidence, not schedule
  writer UI acceptance.
- Complete Xero integration file: **5/5 passed**, exit 0, using
  `test_pr3499_95aafcdd15_xero`. The missing-net-amount case reloads the durable
  per-line error, confirms zero provider calls, and rejects stale-owner writes.
  Transport remains mocked in this suite.
- Billing package build: **passed**, exit 0. Billing package typecheck passed
  with `NODE_OPTIONS=--max-old-space-size=12288`; the default-heap attempt
  aborted at Node's ~4 GiB heap limit without a TypeScript diagnostic.

Exact-HEAD CI run `38398955637` passed CE and EE server image builds, community
and enterprise production-browser jobs, and the other listed regression lanes.
The separate exact-HEAD Nx affected typecheck `38398954240` and translation
workflow `38398954157` passed. The final **Production regression readiness**
job failed only in the workspace lane: quarantined
`teams-development-execution` had no `evidence.json`, and its aggregate
`workspace-execution-gate` therefore reported failure. This does not represent
a contract-invoice assertion failure; the overall CI gate is not green.

The current PR head is `95aafcdd15e983d237d48ab15c4c0f69bd7d106e`, its base is
current main `450070437d770ba651a63b4318a72a9de4e8fc7c`, and GitHub reports it
mergeable with merge state **BLOCKED** by checks. The PR head matched local and
upstream before this evidence commit. No app server was started or restarted.

**Status remains BLOCKED.** Portal comparison, a real app-to-Xero-simulator
delivery, current-build live walkthrough, and companion schedule-writer/browser
acceptance still require the separately authorized smoke step. Do not mark the
whole card accepted from DB suites, mocked transport, CI browser suites, old
screenshots, or database-only fixture inspection.

### Main advancement and final candidate

After the verification above, `main` advanced to
`ecd8a1644322ef39335d09097ae8bd8274d50cff` (`chore: bump version to 1.6.11`).
It merged without conflicts in merge commit `04bb04b53c61e11f4bcf751487bbe1a0ce831b5d`.
That merge changes only the version fields in `packages/core/package.json` and
`server/package.json`; no invoice source or test file changed. The settlement,
companion, Xero, fixture, billing build and billing typecheck results above were
run immediately before this metadata-only merge, on `62e413ada2`; they are not
misreported as reruns on the merge commit.

The full CI run `38431409531` was triggered for `62e413ada2` before the main
merge and is not evidence for the post-merge candidate. The post-merge commit
and this evidence update must be pushed and CI rechecked on that new head. Keep
the review guide **BLOCKED** until those exact-head results and the separate
live portal, Xero, and companion schedule-writer acceptance are complete.

### Exact-head revalidation — 2026-10-13 (`d590c84da1`)

The worktree started at the published PR head `d590c84da1246ffb310d519c62046b4ae5b7ce4a`, with base `ecd8a1644322ef39335d09097ae8bd8274d50cff`. The remote PR head matched; no merge conflict remains. This head adds the post-merge handoff only; implementation source is unchanged from the already reviewed merge. The owned fixture was audited read-only again against database `server`: both September 1–October 1 service periods remain unclaimed, with the October 1–November 1 invoice window. It remains reserved for later UI generation.

Current local validation on `d590c84da1`:

- Contract adjustment settlement DB suite: **66/66 passed** in disposable database `test_pr3499_d590_settlement`. The consolidated-period tests call `BillingEngine.recalculateInvoice` with canonical companion ledger fixtures and cover settlement identity, tax/totals, the single ledger delta, and no-op repeat.
- Companion quantity/history/true-up DB suite: **121/121 passed** in `test_pr3499_d590_companion`. This does not establish schedule-writer UI acceptance.
- Xero integration file: **5/5 passed** in `test_pr3499_d590_xero`. The adapter is mocked; tests verify persisted per-line errors after rollback, zero provider calls on failure, and stale-owner fencing. This is distinct from direct simulator replay and real app-to-simulator delivery.
- Focused expanded-save and percentage-total UI regressions: **20/20 passed** using `ManualInvoices.expandedSave.test.tsx` and `manualInvoiceTotals.test.ts`.
- Billing package typecheck and package build: **passed**.
- Server TypeScript check: **passed** using `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p server/tsconfig.json`.
- Enterprise production build: **passed** in isolated output `server/.next-pr3499-d590-validation-20261013-1655`; compilation completed with existing scheduling star-export, dynamic-dependency, Edge Runtime `process.cwd()`, and dynamic `headers()` warnings, all 74 static pages generated, and build traces collected. Exit 0. The first attempt was stopped with exit 130 before completion when I noticed it shared a pre-existing output directory; the successful retry used the unique path above.
- Read-only owned fixture audit: **passed**. No invoice was generated and no delivered/shared fixture or billed/locked history was changed.

The existing candidate is `REVIEW-3499-UNBILLED-20261012-dcd6e36f`, client `5ba78228-ace1-4990-b42f-30739458299a`, assignment `4921ceb2-72f5-4f0a-afdc-da256e932c41`. Expected preview remains gross A$320.00 less 12% contract discount A$38.40, Cabling-only 10% discount A$12.00, and fixed contract discount A$25.00: subtotal A$244.60 before tax. The baseline queries, exact recurring-period IDs, domain-action preparation record, and cleanup boundary are above. Automated generation ran only in disposable test databases. Do not generate this review candidate until the separately authorized smoke step.

At that smoke step, first rerun the read-only audit, open **Billing → Invoicing → Automatic Invoices**, and select candidate key `invoice-candidate:5ba78228-ace1-4990-b42f-30739458299a:2026-10-01:2026-11-01`. Capture the displayed period and preview before generation; verify the contract-wide 12% base, the Cabling-only 10% base (A$12, not the historical defect's A$32), fixed discount, and A$244.60 subtotal. Then generate exactly once from this candidate and record the resulting invoice ID, persisted line/source IDs, tax and total; refresh/reopen to establish idempotency without generating a second invoice. Preserve the generated draft and fixture until reviewer sign-off. Never unlock or regenerate delivered history. Use separate disposable databases for any automated generation reruns.

CI run `38431581711` on `d590c84da1` was still in progress. Its `temporal / fast-readiness` check passed, including the previously quarantined workspace check; Citus, browser image/build and other workflow jobs were still running. Keep this guide **BLOCKED** until current-head CI is complete and the separate fresh browser, portal, real application-to-Xero-simulator, and companion schedule-writer walkthroughs pass. No app server was started or restarted. Direct simulator replay was not performed; mocked adapter results do not count as delivery.

### Builder mitigation — 2026-10-13 (`3a2df83175e40dbd440ba47108ad56fb10e1982b`)

The worktree was already at the published PR head; the PR head and upstream
branch both matched `3a2df83175e40dbd440ba47108ad56fb10e1982b`. GitHub reported
PR #3499 open and mergeable, with no merge conflicts. The new exact-head CI run
is `38439522644`. `Nx affected typecheck` and `ee-workflows-build-guard` passed.
The run was still active at the time of this handoff; later checks and their
failure status are recorded at the end of this section. Recheck the run before
human review; do not treat pending checks as passed.

No source repair was indicated by the current-head evidence: the production
recalculation regression already calls `BillingEngine.recalculateInvoice` with
canonical companion ledger fixtures, the source wizard identity repair and
shared preview evaluator are present, and there is no reproduced failing
assertion at this head. No application source was changed in this round.

Fresh validation on `3a2df83175e40dbd440ba47108ad56fb10e1982b`:

- Contract adjustment settlement DB suite: **66/66 passed**, isolated DB
  `test_pr3499_step_20261013_settlement`.
- Companion quantity/history/true-up DB suite: **121/121 passed**, isolated DB
  `test_pr3499_step_20261013_companion`.
- Xero integration file: **5/5 passed**, isolated DB
  `test_pr3499_step_20261013_xero`. It verifies the durable per-line
  `missing_net_amount` error, zero provider calls on failure and stale-owner
  fencing; transport is mocked and does not establish simulator delivery.
- Expanded manual-row save and percentage-total UI regressions: **20/20 passed**.
- Billing typecheck, server TypeScript check, and billing package build: passed.
- Owned fixture audit: passed read-only; both September service periods remain
  unclaimed and unlinked.
- Isolated enterprise production build: **passed**, exit 0, in
  `server/.next-pr3499-step-20261013-prod`, with `NEXT_BUILD_CPUS=1` and a
  12 GiB Node heap. It compiled, generated all 74 static pages and collected
  traces. Existing scheduling export, dynamic dependency, Edge Runtime and
  dynamic `headers()` warnings remain.

Exact-head CI run `38439522644` is still in progress. The affected Nx unit job
`115457524172` is currently marked failed. Its failure was investigated after
the reviewer supplied the log; see **Scheduling CI failure investigation**
below. Several server unit shards and browser jobs remained pending at this
checkpoint. Do not call this run green. Other completed contract-relevant jobs,
including affected typecheck, EE workflow build guard, integration, Citus and
workspace execution gates, passed at the latest check.

Commands and DB isolation used:

```sh
cd server
TEST_DB_NAME=test_pr3499_step_20261013_settlement DB_HOST=127.0.0.1 DB_PORT=5472 \
  npx vitest run --config .vitest-tmp-review/pr3499-validation.config.ts \
  ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts \
  --maxWorkers=1 --pool=forks --no-file-parallelism --reporter=dot
TEST_DB_NAME=test_pr3499_step_20261013_companion DB_HOST=127.0.0.1 DB_PORT=5472 \
  npx vitest run --config .vitest-tmp-review/pr3499-validation.config.ts \
  src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts \
  --maxWorkers=1 --pool=forks --no-file-parallelism --reporter=dot
TEST_DB_NAME=test_pr3499_step_20261013_xero DB_HOST=127.0.0.1 DB_PORT=5472 \
  npx vitest run --config .vitest-tmp-review/pr3499-validation.config.ts \
  src/test/integration/accounting/xeroLiveExport.integration.test.ts \
  --retry=0 --maxWorkers=1 --pool=forks --no-file-parallelism --reporter=dot
```

The read-only setup check for the owned generation fixture is:

```sh
PR3499_FIXTURE_DB_NAME=server node --import tsx scripts/audit-pr3499-unbilled-fixture.ts
```

The fixture is `REVIEW-3499-UNBILLED-20261012-dcd6e36f`, client
`5ba78228-ace1-4990-b42f-30739458299a`, assignment
`4921ceb2-72f5-4f0a-afdc-da256e932c41`. It contains Managed Workstation
A$200 and Cabling A$120, with independent copied terms: 12% contract-wide,
fixed A$25 contract-wide, and 10% Cabling-line-only. The September 1–October 1
service periods feed the October 1–November 1 arrears window. Expected preview
is gross A$320.00, discounts −A$38.40, −A$12.00 and −A$25.00, subtotal
A$244.60 before tax. Navigate through **Billing → Invoicing → Automatic
Invoices**, select candidate
`invoice-candidate:5ba78228-ace1-4990-b42f-30739458299a:2026-10-01:2026-11-01`,
capture preview, then generate exactly once only during the separately
authorized smoke. Capture resulting invoice/line/source IDs, tax and total,
reload and verify stable identities and totals. Keep the draft for review.

There is no SQL reset for this candidate. Do not delete claims or delivered
history to make it eligible again. If an authorized walkthrough generates the
draft, preserve it through review; only use the supported **Reverse Draft**
action after reviewer sign-off, then rerun the audit and document the resulting
period state before any further attempt. Never reset or re-export delivered
QBO/Xero history.

For the companion live acceptance, use an isolated monthly contract and an
unbilled 30-day period. In the supported **Schedule recurring change & history**
UI, default to boundary-only, opt in to the mid-period true-up, increase 10 to
13 seats at $100 on day 16, preview one signed `3 × $100 × 15/30 = $150`
true-up, then generate/refresh through the app and repeat generation. Confirm
one canonical revision-linked source row, already-prorated amount consumed once,
shared 10% discount/tax treatment, unchanged retry IDs and posted ledger delta,
then verify next-period standing gross is $1,300 with no repeated true-up.
Also cover a decrease/cancellation and protected finalized history. Capture
revision/version, affected half-open period, invoice/ledger IDs, preview, PDF and
portal parity. The Xero gate requires initiating export from the application
against the simulator and retaining captured simulator requests and response;
direct payload replay and mocked adapter tests do not qualify.

**Status remains BLOCKED** for current-head browser freshness, customer portal
parity, real application-to-Xero-simulator delivery, and companion schedule
writer UI acceptance. The app server stayed stopped. Existing delivered QBO
fixtures and all shared financial history remain untouched. Review the exact
CI run and production recalculation regression first, then perform the separate
authorized live walkthrough; implementation validation is complete, human
review readiness is not.

### Builder re-audit — 2026-10-13 (`65f4fabdf0`)

The local branch and `origin/feature/contract-invoices-automatic-adjustments-and-disc` match at `65f4fabdf08333edeac56d330536a0364d2696a7`. PR #3499 is open against `aa4e1e5db3e4834ba1877b53dbc178819d975cd2` and reports **MERGEABLE**. `origin/main` is that base; no additional merge is needed. The application source is unchanged from the exact source validation at merge commit `5bf290f894fd29e2243fd23feee717ebb8340e9b`; commits since that merge update evidence prose only. That source revision has the recorded 66/66 settlement DB cases, 121/121 companion quantity/history cases, 5/5 mocked Xero integration cases, 20/20 expanded-row/percentage UI regressions, billing and server typechecks, billing build, and isolated enterprise production build. The settlement suite exercises `BillingEngine.recalculateInvoice` with canonical companion ledger fixtures. The Xero tests prove durable per-line missing-net errors, zero provider calls on failure, and stale-owner fencing; they do not prove simulator delivery.

Exact-head GitHub CI run `38457533604` is **IN_PROGRESS**. At re-audit, no job had failed. The affected unit tests, server unit shards, integration shard 4, workspace DB tests, combined Citus migrations, and CE/EE browser image builds were still running. Recheck this run before review and inspect any failed job's actual log before changing source. The prior scheduling assertion was not shown to be a product defect; do not weaken it without a reproduced cause.

The owned generation candidate passed a read-only audit against database `server`. Client `5ba78228-ace1-4990-b42f-30739458299a`, assignment `4921ceb2-72f5-4f0a-afdc-da256e932c41`, and both September service-period rows (`fe039803-e891-4faf-89d0-7b3ec84af1c5`, `dea8e371-e639-4650-87a3-87fa8ce42f28`) remain in `generated` state with no invoice or charge-detail link. Their invoice window is October 1–November 1, 2026. Candidate `REVIEW-3499-UNBILLED-20261012-dcd6e36f` is reserved; expected preview is A$320 gross less A$38.40 (12% contract), A$12 (10% Cabling line), and A$25 fixed, for A$244.60 before tax. The older A$244.60 preview is historical; recalculate in the app.

No app listener was present on ports 23185, 3185, 3000, 3001, or 3002, so current-head browser acceptance could not run under the no-start restriction. Control, QBO, and Xero simulator listeners were present on 29500, 24020, and 24060. Their `/health` paths returned 404; listener presence does not establish simulator health or acceptance. Do not send direct payload replay as a substitute for an app-originated Xero export.

#### Current-head reviewer walkthrough

Keep this guide **BLOCKED** until every live gate below has evidence from an already-running application built from the reviewed source. Preserve the owned unbilled candidate and all delivered/billed history.

1. **Draft editing:** open Billing → Invoicing → Drafts and select an editable contract invoice. Add a freeform and catalog-backed charge and discount, exercise tax and service attribution, edit/remove manual rows, and save with an expanded row open. Confirm generated recurring charges are protected, manual IDs and attribution survive save/reload, invalid drafts fail usefully, and the percentage discount recalculates from the final set after additions, edits, and removals. Verify a blocked lifecycle/export state explains the permitted next action.
2. **Automatic generation and replay:** rerun the read-only audit above, open Automatic Invoices, select candidate key `invoice-candidate:5ba78228-ace1-4990-b42f-30739458299a:2026-10-01:2026-11-01`, and capture its recalculated preview. Confirm gross A$320, discounts A$38.40/A$12/A$25, and A$244.60 subtotal before tax. Generate once through the app and capture the exact generation request, including its replay/idempotency identity. Record invoice, charge, source-settlement, tax, and ledger IDs/amounts. Replay that same captured request before editing; assert it creates zero invoices or postings and retains the source-settlement IDs and totals. Add and save a manual line through the UI, recording its ID and the new authoritative totals. Replay the original generation request again; assert there is still only one invoice, no additional posting, unchanged source-settlement IDs, and the manual line remains present with the saved totals. Refreshing the screen alone is not a generation retry. Retain the resulting draft for review.
3. **Customer output:** compare persisted signed amounts and tax in the MSP preview and PDF, then sign in as the appropriate client portal contact and compare the portal projection. Historical screenshots and shared mapper code do not establish current-head portal output.
4. **Xero simulator delivery:** configure the real app against the existing Xero simulator at port 24060, create a fresh isolated export through the application UI, and retain the app request, simulator response, durable export status, and line-level errors. Verify a missing-net line blocks before provider calls. Mocked transport and direct payload replay do not satisfy this gate. Never unlock or reuse delivered QBO/Xero batches.
5. **Companion schedule writer:** through the supported recurring schedule UI, create a mid-period quantity increase and decrease on an isolated 30-day unbilled period. Verify canonical revision and version, half-open affected dates, already-prorated signed true-up, source-linked settlement on the next eligible editable invoice, one shared discount/tax pass, stable replay IDs, and delta-only ledger reconciliation. Confirm the following period carries the new standing quantity without repeating the true-up. Keep finalized/exported history protected.

No current-head application server was started or restarted. Execution of this walkthrough, including generation-request replay, remains deferred under the no-start restriction. Browser, portal, real app-to-Xero delivery, automatic generation/replay, and companion writer UI acceptance remain **BLOCKED**. Do not mark human-review readiness until these walkthroughs and exact-head CI pass.

### CI recheck — 2026-10-13

The new PR-head workflow `38459986150` is still pending; no failures are reported yet. The earlier run `38398955637` failed its workspace EE unit shard: `WorkflowDesignerPublishErrorReset.test.tsx` expected the workflow switch to become `aria-checked="false"` after pausing, but it remained `true` at line 334 (1 failed, 1,235 passed). The failing test and workflow-designer source have no diff from `origin/main` to this PR, so this is an unrelated CI blocker and no invoice source was changed for it. Inspect the current PR-head workflow again before review; pending jobs are not passes.

### Scheduling CI failure investigation — 2026-10-13

The review log for CI job `115457524172` is available at
`/tmp/pr3499-review-nx.log` in the review environment. It shows one failed test
in scheduling: `tests/timeSheetApproval.test.ts`, “shows existing per-entry
feedback in the manager approval drawer”, assertion at line 333 that the
`[data-feedback-state="unresolved"]` marker exists. Scheduling reported 568 of
569 tests passing; billing in the same Nx job passed all 2,021 tests. The
failing test awaits `flushUi()`, which advances one zero-delay timer turn after
the component's asynchronous work-item fetch effect.

The PR base at the time of review is `ecd8a1644322ef39335d09097ae8bd8274d50cff`.
There is no diff from that base to PR head `a2f6004ddd16fb7ae097f4348c2f6539293f023d`
for the failing test, approval drawer component, or feedback component. This
PR contains no scheduling source change on the failing path.

Local comparison, using `VITEST_SEED=20260610`:

- PR head: the failing test alone passed; the full five-test file passed; and
  the complete scheduling package passed **93/93 files, 569/569 tests**.
- Base `ecd8a1644322ef39335d09097ae8bd8274d50cff`: the full five-test file
  passed; the complete scheduling package passed **93/93 files, 569/569 tests**.

The CI failure is consistent with a timing-sensitive test under the parallel
Nx library run, but it did not reproduce in either local package run. This
evidence argues against an integration regression; it does not prove the same
CI-only flake existed on base. No unrelated scheduling source or assertion was
changed. CI run `38439522644` remains failed on this assertion and is a
remaining automated CI blocker until an authorized rerun or separate
scheduling repair establishes its status.

On final PR head `a2f6004ddd16fb7ae097f4348c2f6539293f023d`, the evidence-only
commit did not change application source. The latest `gh pr checks 3499` query
showed circular-dependency, locale, translation, security and import guards
passing; tenant-schema validation also passed. Affected typecheck, changed-file
ESLint and EE workflow build guard were still pending. These checks are pending,
not a green final-head CI result. Fresh browser, portal, real application-to-Xero
simulator and companion schedule-writer acceptance remains **BLOCKED**; the
app server remains stopped.

### Current source-head verification — 2026-10-13 (`5bf290f894`)

This is the authoritative source-validation snapshot; earlier sections record
historical checkpoints. The source head `5bf290f894fd29e2243fd23feee717ebb8340e9b`
was pushed to PR #3499. Subsequent docs-only handoff commits leave this
application source unchanged. It merges current
`origin/main` at `aa4e1e5db3e4834ba1877b53dbc178819d975cd2`; the merge tree had
no conflicts, GitHub reports `mergeable: MERGEABLE`, and `mergeStateStatus:
BLOCKED` while required CI runs.

Current-source validation on `5bf290f894`:

- Billing typecheck passed with a 12 GiB Node heap; server TypeScript check
  passed with the same heap.
- Billing package build passed.
- Settlement database suite: **66/66 passed**. The consolidated-period
  regressions call `BillingEngine.recalculateInvoice` with canonical companion
  ledger entries and verify allocations, tax, principal delta, stable IDs and
  no-op repeat recalculation.
- Companion quantity/history/true-up database suite: **121/121 passed**.
- Xero integration: **5/5 passed** with mocked transport, including durable
  per-line validation errors and stale-owner fencing.
- Expanded-row save and percentage-total UI regressions: **20/20 passed**.
- Translation validation passed with 10 locales, zero errors and zero warnings.
  Targeted ESLint exited 0 with pre-existing warnings and no errors.
- Enterprise production build passed with one worker and a 12 GiB heap. It
  compiled, generated **74/74 static pages**, and collected traces. The build
  output used a unique dist directory under `/tmp`; no app server was started.

The read-only fixture audit passed in database `server`. Client
`5ba78228-ace1-4990-b42f-30739458299a`, assignment
`4921ceb2-72f5-4f0a-afdc-da256e932c41`, and both September period rows remain
unclaimed for the October 1–November 1 invoice window. The three active copied
terms remain 12% contract-wide, fixed A$25 contract-wide, and 10% Cabling-only.
The recorded candidate preview is A$320 gross less A$38.40, A$12 and A$25,
for A$244.60 before tax. The preview is historical; recalculate in the later
authorized walkthrough. No generation, reset, or history mutation occurred.

Exact-head CI on `5bf290f894` was rechecked again before this handoff update.
GitHub reported 44 successful checks, one skipped check, 24 in progress, and
two failed checks. The primary completed failure was
`integration / Workspace database tests` (job
`115500664821`, workflow run `38455744857`): dependency installation failed
before tests ran because `npm ci` received `ECONNRESET` fetching Playwright
from `registry.npmjs.org`. The paired `Workspace database execution complete`
job failed downstream while collecting/verifying absent test evidence. This
is an observed registry/network infrastructure failure, not a product test
result. Twenty-four other checks were still pending; pending checks are not
passes. Recheck exact-head CI after publishing this documentation update.

The served guide at
[`http://100.109.101.64:23186/`](http://100.109.101.64:23186/) has been corrected
to identify the `add212` browser smoke as historical, report the existing
unbilled fixture, replace the stale running-build claim with the completed
build result, and supersede the obsolete merge-conflict statement. It remains
**BLOCKED** for current-head browser walkthrough, portal parity, actual
application-to-Xero-simulator delivery, and companion schedule-writer
acceptance. The app server remains stopped.
