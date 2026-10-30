# Contract invoice takeover verification — 2026-09-27

Baseline: `230b8531329db5dd7af90e92afc4dec25593b2ab`. Tests and live smoke below include the repairs committed with this record. The approved specification remains `docs/plans/2026-09-22-contract-invoice-adjustments-plan.md`.

## Repairs

Invoice generation posts `invoice_generated` before finalization. Updating only invoice totals left that posting stale; recording the full invoice on every save instead double-billed the ledger. `reconcileInvoiceAdjustmentTransaction` now compares the calculated total with completed generation/adjustment postings and appends only the signed difference. Payments and credits do not enter the principal base. Repeated saves post nothing. Drafts with no generation posting remain unposted. Existing transaction identities remain intact. Recalculation reads and locks the invoice inside its transaction, and adjustment balance reads lock the client.

The new DB coverage uses the real generation posting helper, then the manual invoice action, in USD and EUR. It verifies additions, reversals, operation replays, unchanged payments, balances, and concurrent recalculation producing one adjustment. The prior transaction-free fixture remains a separate imported/unposted case. The recurring-detail unit tests now assert totals and transaction reuse without expecting the obsolete full-amount posting call.

Live template authoring exposed `crypto.randomUUID is not a function` on the HTTP review host. The template panel now uses the existing `uuid` helper, with a component regression for browsers without `randomUUID`. The contract discount label now says “Contract attachment”, replacing the misleading “Shared” label in all supported locales and regenerated pseudo-locales. The translated description and edit notice also now describe independent copies; the component fallback already used the correct model. The contract screenshot was captured before that final description correction. The discount-authoring test now permits contract-wide and service-wide terms without a line, as required by the approved scope.

## Live evidence

The supervised service ran in this worktree on port 3185 using the saved 8 GiB `npm run dev:turbo` command. Authentication used the configured `http://100.109.101.64:3185` origin. PostgreSQL was `server` on 5472. All seven discount migrations were already in batch 54; none were reapplied.

The previous cache quarantine remained in place. This session served real invoice and template operations without an OOM. Observed RSS was about 4.8–5.3 GiB across the session; `health.txt` records successful HTTP probes. This verifies the exercised flows, not a long-term memory soak.

| Flow | Evidence and result |
| --- | --- |
| Posted contract invoice add/edit/repeat/remove | `posted-ui-assertions.jsonl`: invoice and ledger principal agree at 390000 → 405000 → 420000 → 390000 minor units; repeat saves leave adjustment counts unchanged. `posted-add-preview.png`, `posted-edit-preview.png`, `posted-remove-preview.png` show the actual editor and preview. |
| Customer output | `TAKEOVER-POSTED-20260927.pdf` was downloaded through the UI and parsed with `pdftotext`; restored invoice total is $3,900. Prior round evidence contains signed credits, partial-period additions/reductions and taxable-line PDFs. |
| Template authoring | `template-percentage-reloaded.png`, `template-edit-cancel.png`, `template-line-term.png`: add, reload, edit and cancel work, including a line-specific fixed term. |
| Template copies | The client wizard created two draft contracts from the same template for different clients. `created-contract-lines.json` proves each retained two distinct Fixed lines. The four copied discount IDs are distinct; each fixed term targets source line A only. |
| Copy independence | `template-copies-after-template-edit.json`: changing the template from 12.5% to 20% leaves both copies at 12.5%. `template-copies-after-client-edit.json` and `contract-copy-a-edited.png`: editing copy A through its Discounts tab changes only A to 15%; B stays at 12.5%. |

The owned posted invoice included copied canonical detail rows and remapped charge IDs, plus a generation posting. It did not claim new recurring coverage. Template skeletons were seeded by SQL; discount authoring, wizard instantiation and client-copy editing used the actual UI. Creation scripts and tenant-scoped cleanup SQL are included. `cleanup.json` verifies the owned invoice, transactions, contracts and template are gone. Existing `SMOKE-ADJ-1` remains at 371400 minor units, revision 63; `INV-000039` remains at 390000, revision 0. Neither original was edited.

## Automated verification

- Billing unit suite: 318 files, 1,602 tests passed.
- Contract invoice adjustment DB suite: 46 passed, using isolated `test_contract_invoice_takeover` on port 5472.
- Server billing-engine unit suites: 13 files, 68 tests passed.
- Manual recurring-charge guard suite: 3 passed.
- Billing build passed. Supervised dependency builds and live Next.js routes completed.
- Billing typecheck: 11 existing diagnostics in unchanged profitability-report and shared-editor files; no diagnostics in the repair files. `typecheck-diagnostics.txt` lists them. Typecheck is not clean.
- Changed-file eslint: zero errors; existing warnings remain.
- `npm run test:i18n`: passed, including 32 test cases and locale/wiring audits.

Reproduce from the worktree:

```sh
(cd packages/billing && npm test)
(cd server && TEST_DB_NAME=test_contract_invoice_takeover DOTENV_CONFIG_PATH=../.env.localtest node -r dotenv/config ../node_modules/vitest/vitest.mjs run ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts)
(cd server && SKIP_DB_TESTS=1 node ../node_modules/vitest/vitest.mjs run src/test/unit/billing/billingEngine.*test.ts --coverage.enabled=false)
npx nx run @alga-psa/billing:build
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p packages/billing/tsconfig.json
npm run test:i18n
```

## Remaining integration limits

Client-portal invoice output still lacks an authenticated client-contact smoke session. No accounting export artifact or external posting was produced. The CSV adapter also requires classified service mappings; viewing an existing pending batch is not export validation. The companion branch was not merged or modified, and combined automatic true-up acceptance remains outstanding. The supplied source-linked `contract_change` interface remains the integration boundary; this repair adds no quantity/history writer. These are release-verification limits, not completed acceptance.

The temporary Draft Implementation service-use declaration was removed after smoke and the supervised service was concluded. The workflow card was not advanced. Untracked `server/.next-review/` was untouched.
