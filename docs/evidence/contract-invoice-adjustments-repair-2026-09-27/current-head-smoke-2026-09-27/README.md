# Current-head smoke and repair evidence — 2026-09-27

Application branch: `feature/contract-invoices-automatic-adjustments-and-disc`
Commit at smoke start: `dd44662150b1a9d76332dfb7a9d167dc76f5227d`
Browser: supervised `dev-server`, `http://localhost:3185`
Database: `server` on PostgreSQL port `5472`, compose project `alga-psa-local-test`
Tenant: `6d178771-ad9a-4d43-8809-83992745f8f9`

## Service stability and workspace cause

The saved supervised service is `NODE_OPTIONS=--max-old-space-size=8192 HOST=0.0.0.0 PORT=3185 npm run dev:turbo` from this worktree's `server` directory. Startup and restart were performed only with `alga-dev workflow-ensure-service`. The two preceding 8 GiB OOMs were correlated with a generated Turbopack dev cache that had grown to 9.7 GiB. That cache was moved intact to `/tmp/contract-invoice-turbopack-cache-pre-repair-20260927`; it was not committed or deleted. With a clean cache the service served the actual billing UI and passed repeated 10-probe health series (all HTTP 200). During the completed invoice operations its `next-server` process held about 4.08 GiB RSS at two observations 20 seconds apart, below the configured 8 GiB Node heap; health remained HTTP 200 throughout. The clean cache grew to about 2.1 GiB. No second server was launched and the saved command was not replaced.

Workspace repairs from earlier mitigation rounds are documented in the parent evidence report. The npm workspace and package lock remain the tracked package-manager source of truth; local pnpm selector artifacts were preserved outside the tree and are not part of this repair.

## Operator smoke

The controlled invoice `SMOKE-ADJ-CURRENT-20260927` was cloned from generated invoice `INV-000039` with all three `invoice_charges`, their canonical `invoice_charge_details`, and remapped charge references. It was operated from **Billing → Invoicing → Drafts**. `SMOKE-ADJ-TAX-20260927` was a separate clone from non-exempt Cool Cars invoice `INV-000031`, also including its canonical detail. The creation and cleanup scripts are included below.

On the first controlled draft, the operator added a freeform line, edited it, selected Florida 6% tax, added a fixed scoped discount, added a 10% line-scoped discount, repeated the save, added a manual credit, and removed the temporary lines. Screenshots:

- `screenshots/complete-fixture-after-save.png`
- `screenshots/complete-fixture-edit-saved.png`
- `screenshots/complete-fixture-percentage-repeat-save.png`
- `screenshots/complete-fixture-credit-before-save.png`
- `screenshots/complete-fixture-after-removal.png`

The generated recurring product rows stayed in the read-only Automated Line Items list while manual lines were edited. The manual credit was saved with `quantity=3`, `unit_price=-1000`, `net_amount=-3000`, `is_manual_credit=true`, and `is_discount=true`. The UI shows a positive `$30.00` magnitude next to the explicit “Credit” label and `3 × $-10.00`; the preview reduces the total by $30.00 and the generated PDF prints amount `-$30.00`. The credit was then removed in the UI; the partial-period rows remained and invoice totals returned to $3,900. That positive magnitude is the intended credit presentation, not a positive invoice charge. Evidence: `screenshots/manual-credit-saved-preview-db-parity.png`, `screenshots/manual-credit-removed-preview-db-parity.png`, and `SMOKE-ADJ-CURRENT-20260927-credit.pdf`. The original drifted invoice `SMOKE-ADJ-1` was only snapshotted and inspected; it was never changed.

The first repeat-save uncovered a projection defect: `Invoice.getInvoiceCharges` did not select `discount_type`, `discount_percentage`, or target fields, so a reloaded percentage discount could be treated as a zero fixed discount. Those fields are now selected. The focused DB regression verifies type, percentage value, and target survive reload. The live percentage line was saved twice with a persisted `-600` (10% of $60) and no duplicate discount row; screenshot above.

The non-exempt tax clone was used for UI save/repeat-save and PDF checks. A taxable line with quantity 2, unit rate $30, and the Florida 6% rate produced persisted `net_amount=6000`, `tax_amount=360`, `is_taxable=true`, and `tax_region=US-FL`. Invoice totals, preview, and generated PDF agreed at subtotal $61, tax $3.60, total $64.60. The generated recurring detail remained present. A further save left financial transaction count at zero and advanced only the draft revision. See `screenshots/tax-fixture-preview-db-parity.png`, `tax-db-before-cleanup.txt`, and `SMOKE-ADJ-TAX-20260927.pdf`.

The partial-period calculator was exercised against the generated Locations service, whose canonical billed period is 2026-08-01 through 2026-08-31 at $200 per unit. An increase and decrease of one unit effective 2026-08-16 each resolved to 16/31 × $200 = $103.23; persisted signed amounts were +10323 and −10323, with exclusive period end 2026-09-01, attribution, and reason intact. The pair preserved the original $3,900 total. The PDF contains both signed rows and the same total as the database and preview; see `screenshots/partial-period-increase-saved.png`, `screenshots/partial-period-increase-decrease-parity.png`, and `SMOKE-ADJ-CURRENT-20260927.pdf`.

That repeat-save also exposed duplicate financial activity: the prior draft recalculation inserted a completed `invoice_adjustment` transaction for the **full invoice total** on every save. The repair changes recalculation to update draft subtotal/tax/total only. A new DB regression runs recalculation twice and asserts that no transaction rows are created. Existing accidental test transactions were scoped by the owned invoice IDs and exact generated description, then removed along with the owned drafts; client balance rows preceding the test were not touched.

## Template, lifecycle, exports, and remaining output checks

The complete `contractInvoiceAdjustments.db.test.ts` suite passed 43/43. It includes independent template discount copies, preservation when a template is edited, distinct same-method Fixed/Fixed template-line sources, source-linked discount reconciliation, lifecycle capability checks (finalized, paid, cancelled, and exported), and draft revision/attribution behavior. One existing focused case is `keeps fixed and Fixed template sources separate through creation and settlement`. These template-copy and same-method checks are regression coverage; a separate live template-authoring UI session was not captured in this smoke.

A read-only finalized invoice (`INV-000027`) showed no draft adjustment editor. Evidence: `screenshots/finalized-invoice-protected-view.png`. The DB regression checks reject finalized, paid, cancelled, and externally mapped invoices.

The Accounting Exports screen is available. Its existing `quickbooks_csv` batch `4a6ea667-dcd7-4190-8177-1a34674b8e83` was Pending with 17 lines and 0 errors; it was opened read-only and not executed. The UI exposes an Execute control but no separate output preview/download in that drawer, so no export artifact was produced and no external accounting system was contacted. See `screenshots/accounting-export-existing-pending-batch.png`.

Client portal navigation redirected this MSP browser session to `/auth/msp/signin?callbackUrl=%2Fmsp%2Fdashboard`; no authenticated client contact session was available. Evidence: `screenshots/client-portal-auth-blocker.png`. Portal invoice output remains unverified. The first PDF attempt failed because Puppeteer Chrome 154.0.8037.57 was missing. After restoring that exact local browser with `npx puppeteer browsers install chrome@154.0.8037.57`, the supervised UI Download PDF action succeeded. The browser pane did not expose a filesystem download path, so I captured the exact generated Blob from that UI action; both PDFs were parsed with `pdfinfo` and `pdftotext` and match database and preview amounts. No invoice was sent. The companion quantity-change branch was not merged or modified and no authorized combined integration environment was available; no fabricated `contract_change` row was used as end-to-end evidence.

## Database safety and cleanup

`operator-db-before-cleanup.txt` and `tax-db-before-cleanup.txt` record totals and linked row counts before cleanup. `cleanup-verification.txt` records zero remaining invoice, charge, or transaction rows for the owned fixture IDs. It also confirms the original generated invoice `INV-000039` remains `390000` subtotal, `0` tax, `390000` total, revision 0, and three charges. The original drift snapshot is `fixture-before.json`.

Migrations `20260927010000` through `20260927070000` are already recorded in `knex_migrations`, batch 54; they were not reapplied. They are also checked in `cleanup-verification.txt`.

## Reproduction and verification

Run from the repository root. The database password is read inside the Postgres container and is intentionally not printed:

```sh
alga-dev workflow-ensure-service --projectId=b97eda7b-0e3f-4b09-be80-6b57f934d8a5 --name=dev-server
for n in 1 2 3 4 5 6 7 8 9 10; do curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' http://localhost:3185/api/health; sleep 2; done
npx nx run @alga-psa/billing:build
cd server
DOTENV_CONFIG_PATH=../.env.localtest node -r dotenv/config ../node_modules/vitest/vitest.mjs run ../packages/billing/src/services/contractInvoiceAdjustments.db.test.ts
```

The billing build passed. The contract adjustment DB suite passed 43/43. Billing typecheck required an 8 GiB Node heap; it then exited 1 with the same 11 diagnostics previously reported, all in untouched `packages/billing/src/actions/profitabilityReportActions.ts` and `packages/ui/src/editor/{AiResponseBlock,MentionSuggestion,TextEditor}.tsx`. No unrelated typecheck repairs were made. The default 4 GiB typecheck attempt OOMed before producing diagnostics.

The temporary `dev-server` permission on **Draft Implementation** was removed through `alga-dev workflow-update-template` after the final smoke session. The card was not advanced or marked complete. The workflow updater also refreshed two low-confidence automatic step-role judgments (`Implement`, `Pull Request`) while applying the supported template update; this was a workflow metadata side effect, not an application change.
