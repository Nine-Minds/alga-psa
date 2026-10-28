# Service recovery and invoice smoke completed

Verified on `356892db69900cf97b901647f0a7dbcef168aefe`, using the board-owned worktree server on port 3185 on 2026-10-07. This takeover changes evidence only. The migration-owned ledger test cleanup and same-source foreign-tenant fixture from that commit remain intact.

## Environment

[Command-free ensure](command-free-ensure.json) reused saved service `:19`, its worktree `server/` directory, startup command and readiness `{port:3185,path:"/api/health"}`. [Initial health](health.json) and [final health](final-health.json) returned HTTP 200 while temporary Draft service-use permission was active. The normal policy was restored after smoke: Draft has no service dependency; Smoke Test retains `dev-server`. [Service inventory after cleanup](service-after-cleanup.json) records the retained registration. It was not concluded.

An owned internal user and role signed in through the normal MSP credentials form. Authentication used the configured origin `http://feature-contract-invoices-automatic-adjustments-and-disc.localhost:3185`; starting at the tailnet origin redirected to that hostname. Shared credentials were unchanged. Browser actions used the card pane `02135b4f-23e2-4c1e-a51d-e71c4287c3c1`.

## Setup and routes

Two owned drafts were cloned from `INV-000039`, including its generated charges and canonical detail periods. Each received an explicit synthetic `invoice_generated` posting of 390000 minor units to exercise posted-principal reconciliation. No payment was created. All fixtures were removed afterward.

- `TAKEOVER-POSTED-20261007`: `5a1e0000-0000-4000-8000-202610079001`.
- `TAKEOVER-LIFECYCLE-20261007`: `5a1e0000-0000-4000-8000-202610079002`.
- Entry: Billing → Invoicing → Drafts → select the owned invoice → Invoice adjustments.
- Export entry: `/msp/billing?tab=accounting-exports` → owned batch → Execute → reload → Open → Download.

CSV mappings and pending batches were seeded under the isolated realm `takeover-20261007`. The first seeded batch omitted canonical service-period projections; validation correctly rejected it. Correcting that owned setup to include the persisted detail periods allowed both real adapters to deliver through the UI. No application validation was bypassed.

## Live results

All amounts are USD before tax; these fixtures have zero tax. [Ledger assertions](ledger-assertions.jsonl) record invoice total, posted principal, revision, charge count and transaction count after each observed step.

| Flow | Observed result |
| --- | --- |
| Add, edit, reload, remove a manual charge | $3,900 → $4,050 → $4,200 → $3,900. Invoice total and posted principal agree at each step. Repeat save adds no transaction. Generated charges remain in the read-only automated section. |
| Source-derived partial increase and decrease | SMOKE Prod Users, 3 users, August 16–31, 2026: rounded unit rate $51.61, signed amounts ±$154.83. Persisted total and posted principal agree. Repeat save adds no posting; removing both returns to $3,900. |
| Customer output | [Partial-period PDF](partial-period.pdf) includes service, dates, calculation and both signed amounts; [extracted text](partial-period.txt). The [discount PDF](discount.pdf) and [text](discount.txt) show -$405.10 and $3,645.90. Preview showed the same amounts. |
| Permanent-change navigation | The calculator link resolves assignment `853387ad-f331-4eca-b562-ae23dd2b85a5` to contract `51d53c43-e59d-4461-80fe-854e00774fa9`, opens Contract Lines and focuses `d3076f7b-6256-46d7-be20-e63efacc6f45`. [Reload observation](contract-reload.json) preserves contract and line focus. No contract was edited. |
| Percentage discount and subsequent changes | The saved 10% discount recalculates against generated plus manual charges. Removing the $1 line yields -$405/$3,645; adding it again yields -$405.10/$3,645.90 on the first save. Repeat save leaves the transaction count at 13. |
| QuickBooks and Xero CSV downloads | Both batches delivered. After a full page reload, Open → Download returned six-line files with signed total $3,645.90. Invoice date 09/23/2026 and due date 10/23/2026 match the PDF. [QuickBooks CSV](quickbooks.csv), [Xero CSV](xero.csv), [assertions](download-assertions.json). |
| Durable download parity | Browser download SHA-256 values equal the exact committed database artifact bytes: [artifact records](artifacts-db.json). A byte observer captured the Blob passed by each real Download handler while preserving the browser's original URL and anchor-click behavior. Files were not synthesized from test queries. |
| Delivered export protection | Reloaded draft hides Add Charge/Discount and explains the credit-note/reissue workflow. Attempting to change its invoice number returns the accounting lock reason. Number, revision, total and posted principal remain unchanged. [UI alerts](export-lock-alerts.json). |
| Paid/cancelled/finalized protections | On the separate owned fixture, each protected state was injected after opening an unsaved $1 edit. The real save action rejected the stale edit; total/principal stayed 390000, revision 0, three generated charges. [Write assertions](lifecycle-assertions.json). After fully loaded reloads, adjustment controls were absent: [loaded UI observations](lifecycle-loaded-ui.json). These checks test protected-state enforcement, not payment, void or finalization transitions. |

Screenshots: [manual discount and total](takeover-discount-posted.png), [partial increase](takeover-partial-increase.png), [partial charge and credit](takeover-partial-both.png), [contract focus](takeover-contract-focus.png), [QuickBooks download](takeover-qb-download.png), [Xero download](takeover-xero-download.png), [export lock](takeover-export-lock.png), and loaded [paid](takeover-paid-loaded.png), [cancelled](takeover-cancelled-loaded.png), [finalized](takeover-finalized-loaded.png) screens.

## Verification and cleanup

Billing typecheck and build passed during takeover; build used Nx cache. [Verification record](verification.txt). The builder's full migrated DB suite passed 63/63 after the test repair; [retained log](../db-suite-2026-10-07-review-fix.log). No application or test source changed during this takeover.

[Final financial state](final-financial-state.json) records the exported charges, signed ledger postings and delivered lines before cleanup. Owned invoices, transactions, adjustment operations, batches, mappings, artifacts, document metadata, five storage files, sessions, user preferences, user and role were removed. [Cleanup counts](cleanup-counts.json) are zero. [Before](before.json) and [after](after-cleanup.json) snapshots confirm `INV-000039`, `REVIEW-CONTRACT-3499`, and `SMOKE-ADJ-1` retain their totals, revisions, charge counts and postings. The three existing untracked `.next-*` directories were untouched.

The service recovery and remaining targeted smoke pass. This run does not establish client-portal acceptance, live QBO/Xero API delivery, provider import acceptance, or end-to-end companion quantity-change generation. CSV output used the real application adapters without an external provider. Existing DB coverage supplies automatic-discount and mocked-provider checks; those were not reclassified as live smoke. One stale finalized-save error remained generic (“Error updating invoice”); the mutation was rejected and reloaded controls remained protected. The partial-period button label wraps in the narrow preview column.
