# Review revisions — September 5, 2026

**Follow-up:** [mitigation-evidence.md](mitigation-evidence.md) supersedes the recurring bucket/cap blockers and portal/authentication gaps described here. It records fresh command receipts and the three acceptance cases still incomplete. This file preserves the earlier reproduction and verification history.

This run fixes the three probes supplied in `/tmp/invoice-ticket-lead-review/invoiceTicketReviewerProbe.test.ts`, using the invoice generated during the preceding draft run. Review `collectionResolution.ts`, evaluator collection handling, and the canvas's neutral-data/localized-display boundary first. Then inspect the UI-saved nested alias and PDF below.

## Changes

- Canvas evaluates the same neutral invoice input as full preview/PDF. A serializable document-locale label dictionary translates resolved rows and display-only text afterward. The evaluator restores derived presentation fields from semantic provenance if a caller supplies already-localized display data; it never reverse-translates customer text.
- Canvas and renderer share declared collection-path and repeated-row resolution. Saved collection names survive import/export. Changing a source in the inspector releases the preserved name. Canvas also uses the supplied node tree, and recognizes arbitrary authored row-binding prefixes.
- Scalar and missing collection values stay invalid until their use site, yielding a canvas diagnostic or `INVALID_SOURCE_COLLECTION` in preview/PDF. Empty arrays and absent legacy time collections remain valid empty results. A canvas representation of an empty repeated region does not manufacture a missing-child error.
- Print CSS repeats table headers and keeps individual rows and the totals block together. Existing templates retain their authored columns and financial data.
- Regression tests now cover the actual supplied probes, neutral filters/sorting through rendered HTML, named nested save/reopen, invalid declared paths, and existing standalone canvas previews. Two stale test expectations/mocks were corrected to preserve authored row names and use real sample collection enrichment.

## New production and live evidence

All paths below are under `/tmp/invoice-ticket-revisions/` unless stated otherwise. These are new checks; `/tmp/invoice-ticket-review-run/` remains prior evidence.

| Scenario | Result and evidence |
| --- | --- |
| Original reviewer probes | All three passed against the original generated artifact. The exact copied probe is `invoiceTicketReviewerProbe.test.ts`; it was run temporarily under the server test tree and is not a committed test with a `/tmp` dependency. Durable calculator-driven coverage is in `server/src/test/unit/billing/invoiceTicketPresentation.test.ts`. |
| Production baseline repeated | `baseline/generated.json`: four approved entries across two tickets plus usage, three primary rows, 87500 net + 8750 tax. Production snapshot persistence, immutable rendering after source edits, accounting CSV descriptions/mappings, duplicate guard, French PDF, 2500 account credit, line discount, negative credit, zero information, legacy/partial/v1/unsupported history all passed again. See `baseline/{production,production-fr}.pdf`, `baseline/accounting-export.json`, and `baseline/adjusted.json`. |
| Actual cap and supported inline additions (T010) | `cap/generated.json`: standalone uncontracted project time generates 45000 snapshot net, 20000 billed net, 2000 tax, and 25000 write-down. Both affected charges remain canonical, including the zero row; no uniform rate survives. `cap/cap-usage.json` proves persisted cap usage. Supported manual additions retain a -1000 line discount, -500 credit and zero information row once; `cap/inline-adjustments.json` reconciles 18500 net + 2000 tax = 20500. Snapshots remain unchanged. This exercises the plan's cap plus inline-adjustment alternative; the recurring bucket blocker below is not presented as successful generation. |
| Multiple tax rates (T006) | `multi-tax-long/generated.json`: invoice INV-000088, 74 generated entries across two tickets and two hourly services taxed at 10%/20%, plus usage. Three primary rows reconcile 1137500 net + 167750 tax = 1305250. The multi-tax ticket does not expose a single tax rate. Each persisted charge's contribution amounts reconcile independently. |
| French translated-string filter | On existing custom template `6a36fb1e-18a8-4080-b989-c97ac6867e65`, the live `rateDisplay == Tarifs variables` filter gives zero entry rows in canvas and full preview. `live/invoice-revision-filter-empty-{canvas,preview}-fr.png`. These temporary edits were not saved to the earlier custom template. Use `rateKind == mixed` for language-neutral matching. |
| Named nested alias through UI save/reopen | Template `4a49e0ea-0515-4712-a0ab-e95b1397ccb5` on INV-000088. Opened the seeded existing custom layout, added the Date column through the nested table's preset control, added a `rateDisplay` sort through transform controls, saved, returned to the catalog, and reopened with Edit. `designer/saved-template.json` retains `nestedEntries -> group.entries`, five columns, and the sort. `live/invoice-revision-reopened-nested-{canvas,preview}-fr.png`; actual preview contains 72 + 2 nested rows and the two-hour 37500 mixed entry. Canvas intentionally samples five rows and reports the remaining count. |
| Multi-page nested PDF | `designer/nested.pdf`, `designer/nested.txt`, `designer/preview.html`, `designer/canvas.json`. The final UI-saved document has **four pages**. `designer/reopened-page-{1,2,3,4}.png` are rasterizations of that PDF. Visual inspection confirms long public title/description wrapping, repeated nested headers, the 375,00 mixed entry, readable dates, included-in-charges guidance, and intact totals on page 4. Earlier pre-UI seed PDFs had five pages; the final four-page artifact is the review target. |
| Declared invalid bindings | `diagnostics/sources.json` identifies saved scalar and missing-path layouts on the same generated invoice. Both production preview and PDF reject them with the declared path. `live/invoice-revision-{scalar,missing}-diagnostic-{canvas,preview}.png` show the live diagnostics. No canonical invoice items replace either invalid source. |

## Verification commands and logs

Run from `server` against the existing port-3967 app and `alga-psa-local-test` infrastructure; do not reset or reconfigure the shared database.

```bash
npx vitest run src/test/unit/billing/invoiceTicketPresentation.test.ts --coverage.enabled=false
INVOICE_TICKET_LIVE=1 INVOICE_TICKET_EVIDENCE_DIR=/tmp/invoice-ticket-revisions/baseline \
  npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts --coverage.enabled=false
INVOICE_TICKET_EXTENDED=1 INVOICE_TICKET_EVIDENCE_DIR=/tmp/invoice-ticket-revisions \
  npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts --coverage.enabled=false
INVOICE_TICKET_REVIEW_LAYOUT=seed INVOICE_TICKET_EVIDENCE_DIR=/tmp/invoice-ticket-revisions \
  npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts --coverage.enabled=false
# After the UI edit/save/reopen, use its saved ID:
INVOICE_TICKET_REVIEW_LAYOUT=verify INVOICE_TICKET_REVIEW_TEMPLATE='<saved ID>' \
  INVOICE_TICKET_EVIDENCE_DIR=/tmp/invoice-ticket-revisions \
  npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts --coverage.enabled=false
INVOICE_TICKET_DIAGNOSTICS=1 INVOICE_TICKET_EVIDENCE_DIR=/tmp/invoice-ticket-revisions \
  npx vitest run src/test/integration/invoiceTicketProduction.integration.test.ts --coverage.enabled=false
```

- `/tmp/invoice-ticket-revision-all-final.log`: final combined run passes 190/190 checks across 13 suites (187 committed behavioral checks plus the three supplied artifact-backed probes). Earlier subset logs are retained below.
- `/tmp/invoice-ticket-revision-focused-final.log`: strengthened filter/sort tests also compare actual rendered HTML order; 24 passed.
- `/tmp/invoice-ticket-revision-canvas-tests.log`: 51 canvas/workspace checks passed after correcting supplied-tree evaluation and the stale mock.
- `/tmp/invoice-ticket-revision-{production,cap-inline,diagnostics}.log`, `/tmp/invoice-ticket-{extended,layout-reopened}.log`: production checks described above.
- Build/typecheck final results are recorded in the closing verification note below. Translation validation passed for all nine locales.

## Mocks, setup shortcuts, and limits

- Authentication/session helpers in the opt-in integration tests still use the real synthetic user's identity with stubbed authentication. Billing calculation, tax, transactions, persistence, invoice reads, renderer and PDF service are real. Browser work uses the existing signed-in session. These tests do not establish authentication enforcement or adversarial tenant isolation.
- Source fixtures insert synthetic clients/contracts/services/time/tickets/projects. No completed snapshots are inserted to prove generation. Source edits and corrupt-history simulations retain the earlier explicit DB-only shortcuts; historical variants roll back.
- The existing named-alias/repeating-region template is seeded through the supported `saveInvoiceTemplate` action because the visual editor has no alias-declaration control. Its Date column and sort were authored and persisted through the live UI. Creating the repeating region entirely through visual controls is not claimed. The long invoice is generated from real source entries; neither PDF rows nor completed snapshots are fabricated.
- The calculator unit fixture uses a no-tax port. Existing UI unit suites stub searches/server actions and DnD; these are supplemental to real production/UI evidence. The accounting export envelope is fixture-built, while persisted invoice/charge/mapping reads and CSV transformation are real; no external accounting delivery occurs.
- No portal capability was newly verified. Guidance continues to request a breakdown from the provider and promises no portal billing ledger. Broader plan tests stay false when their full UI/locale/privacy matrix remains unverified; particularly T015's entirely visual creation of a nested region is not claimed despite the completed long-document rendering acceptance.

## Independently reproduced existing billing blockers

These were investigated as required acceptance cases, not deferred as optional checks. `unchanged-billing-paths.json` records current SHA-256 and reviewed-commit blob IDs: `billingEngine.ts`, `calculateContractCharge.ts`, and `invoiceService.ts` are byte-identical to reviewed commit `d60d83bb96`.

1. **Recurring bucket generation:** real usage reconciliation records 300 consumed/240 overage minutes from approved source time. `generateInvoice` then fails because the bucket charge lacks `servicePeriodRecordId`; `invoiceService.ts` rejects it while linking recurring detail. The transaction rolls back with no partial invoice. `bucket/{bucket-usage,blocker}.json` and the opt-in test preserve this failure as an explicit expected-blocker check. Successful recurring bucket generation remains blocked.
2. **Contracted recurring project caps:** INV-000084 preserves 87500 net despite a 20000 project cap; the normalized hourly path drops project charge configuration. `recurring-cap-blocker.json` records the generated invoice, snapshots and canonical charges. The successfully verified cap path is standalone uncontracted project billing. Fixing the unrelated normalization/cadence architecture is outside this renderer/designer revision.

The broader still-false checklist entries retain their original approved descriptions. T006 and T010 are now marked implemented for the new multi-tax financial and cap/inline-addition tests. No successful bucket run, full portal walkthrough, or cross-tenant generation test is claimed.

## Closing verification

Billing package typecheck/build and server typecheck pass on the final code; the server typecheck log is `/tmp/invoice-ticket-revision-server-types-final.log`. The final isolated full server build of implementation commit `5ec37018456368c91b18d7e724483ec0ce12de3f` completed with **exit 0** on September 5, 2026 at 05:12:08 UTC. `/tmp/invoice-ticket-revision-final-build.log` contains the full output, and `/tmp/invoice-ticket-revision-final-build-result.json` records the command, working directory, commit, timestamps, and exit code.

The earlier build had completed its route listing, but its execution handle no longer exposed an exit code. This follow-up preserved that log as `/tmp/invoice-ticket-revision-completed-build.log` and reran the same command with a durable exit-status receipt: `NODE_OPTIONS=--max-old-space-size=16384 NEXT_DIST_DIR=.next-invoice-revision-verification npm run build` from `server`. Generated output was moved outside the worktree to `/tmp/invoice-ticket-revisions/build-output` and excluded from the documentation commit. No implementation changes were needed. The development stack remained running, and nothing was pushed or published.

Full builds skip Next type validation, so the previously completed explicit typechecks remain required; server typecheck uses 12 GB. Existing scheduling/workflow/dynamic-dependency warnings remain visible in the logs. The earlier 190-check behavioral run, translation validation, and plan schema validation were not rerun for this documentation-only follow-up; `git diff --check` passes. The reviewer separately reported 97 passing behavioral tests and successful saved nested-layout production preview/PDF verification. The independently reproduced recurring billing blockers above remain separate follow-ups.
