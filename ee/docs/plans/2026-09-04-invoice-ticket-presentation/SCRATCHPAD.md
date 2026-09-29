# Invoice ticket presentation — working notes

## Assignment and scope

- Design assignment for alga0002322 follow-up; create the four ALGA plan artifacts. Implementation and live acceptance verification belong to subsequent workflow assignments.
- Predecessor: PR https://github.com/Nine-Minds/alga-psa/pull/3314, merged revision `45d8f81f875322342923a00bc81c4bd2cf4c40e7`. This is a standalone follow-up from main.
- Worktree: `/home/robert/alga-copies/feature-invoice-ticket-layouts-finish-rollup-presentatio`; branch `feature/invoice-ticket-layouts-finish-rollup-presentatio`; development port 3967; compose project `alga-psa-local-test`.
- Existing local modifications to `package-lock.json` and `packages/migration-cli/bin/alga-migrate.mjs` predate this assignment. Leave them untouched.
- The commissioning brief supplies the scope and authorizes creating the complete plan. No additional scope-confirmation gate is needed to draft its checklists. Workflow advancement and approvals remain with the XO/captain.

## Initial source findings

- `buildInvoiceTimeCollections` in `packages/billing/src/lib/adapters/invoiceAdapters.ts` groups immutable entry snapshots, compares only each entry's base `rate`, and inserts English mixed-rate/fallback labels.
- `computeTimeBasedCharges.ts` already calculates overtime components, but `buildTimeEntryWorkItemSnapshot` writes version 1 with only the base rate and net amount.
- `preview/previewBindings.ts` uses a separate collection map and falls back to `items` for unknown IDs. `TableEditorWidget.tsx` selects time/ticket presets by literal source IDs.
- `docs/billing/invoice_templates.md` describes both a rollup default and the superseded per-entry-band catalog entry. Its portal detail claim requires verification.

## Validation status

- Findings above are from source inspection. The overtime runtime reproduction and seeded-PDF limitations are commissioning evidence; they have not been re-executed in this design assignment.
- Behavioral, database, browser, and PDF acceptance checks remain pending implementation.

## Design decisions

- Use a new complete renderer collection (`ticketPresentationRows`, provisional name) for one primary table. Keep canonical `items` and existing detail bindings available.
- Replace a charge only with complete, unique, time-only immutable coverage and exact net-amount reconciliation. Partial coverage retains the entire original charge and excludes its snapshots from primary rollups. No guessed residual or historical backfill.
- Version 2 records uniform/mixed/unknown rate evidence from the calculator. Version 1 always has unavailable rate evidence for presentation. Explicit rate components are not required; optional entry detail must still identify within-entry mixed rates honestly.
- Preserve separate adjustments/credits and authoritative totals. Project cap and other inline discrepancies trigger canonical-row fallback; do not allocate write-downs to tickets speculatively.
- Share collection schemas and resolve canvas rows from evaluator bindings. Sort/filter preserve schema; grouped output uses its actual wrapper and nested schema. Unknown explicit bindings must not become invoice items.
- Localize derived display fields with the document translator and effective locale. Keep snapshots and evaluator inputs language-neutral.
- Default to requesting a billed-time breakdown from the service provider. Optional portal guidance is limited to verified client-visible ticket updates, with no promise of billed-entry/rate detail.

## Additional source findings

- Inspected worktree HEAD: `d33175f14c14254221fa9bdc7f0b7d9f4895b604`.
- `packages/billing/src/services/invoiceService.ts::linkAndMarkSourceBillingRecord` writes the snapshot and source link after guarding the invoiced flag, in the existing transaction. Hour-block informational charges can have time-entry links without work-item snapshots; links alone do not establish time-only provenance.
- `packages/billing/src/models/invoice.ts::getInvoiceItems` currently filters null snapshots before `attachTimeEntrySnapshots`. Retain immutable unavailable-link metadata to make coverage checks possible.
- `packages/billing/src/lib/billing/billingEngine.ts` applies project cap write-downs to `charge.total` after charge construction. The unresolved/catalog path separately calls `buildTimeEntryWorkItemSnapshot`; both paths need version-2 semantics.
- `packages/billing/src/actions/invoiceGeneration.ts` exposes `generateInvoice`, selection-input generation actions, production preview construction, and PDF actions. The acceptance path must begin with source entries and run generation, not call only the final persistence helper with a mocked billing result.
- `packages/billing/src/lib/invoice-template-ast/evaluator.ts::evaluateTemplateAst` already returns canonical and transformed collections in `bindings`. Reuse that evaluated context in canvas.
- `packages/billing/src/components/invoice-designer/fields/documentBindingCatalog.ts` serves invoices, quotes, and sales orders; metadata extraction must remain document-kind aware.
- `packages/billing/src/lib/invoice-template-ast/i18nLabels.ts::localizeTemplateAstForLocale` loads the `documents` namespace and resolves effective locale. Its current AST-only traversal does not translate dynamic row labels; add a shared derived-presentation seam, not string replacement.
- Inspected `packages/client-portal/src/components/tickets/TicketDetails.tsx` and `packages/client-portal/src/components/billing/InvoiceDetailsDialog.tsx`. Ticket comments/documents and canonical invoice lines are visible source paths. No live portal verification was performed; omission of the optional portal note is the safe default.

## Checklist sizing and verification handoff

- Estimated scope: roughly 25–30 atomic features. Final checklist: 29 features and 19 representative behavioral scenarios, with multiple feature mappings per scenario. The main skill's Pareto test guidance takes precedence over the older reference's suggestion that tests exceed features.
- Every checklist item is pending. No source-string/import-presence checks are planned.
- For later live evidence, create an `evidence/` manifest in this folder listing source fixture setup, exact generation action/commands, commit, test results, screenshots, PDF text, and a per-charge reconciliation. Use synthetic identifiers in fixtures and redact tenant/customer identifiers from committed evidence.
- Seeded completed snapshots are permitted only for disclosed legacy/corrupt-history cases. They do not satisfy T001, T004, or the production generation acceptance criterion.
- Compare semantic PDF content and source contribution amounts; binary PDF bytes may differ because of renderer timestamps or version changes.
- Browser, integration, and PDF work should use the corresponding repository testing/browser skills when implementation reaches that stage.

## Plan validation

Run from the worktree root:

```bash
python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-09-04-invoice-ticket-presentation
git diff --check
```

- Plan schema validation passed: 29 features, 19 tests, valid feature references.
- Additional handoff checks verify unique IDs, coverage of every feature by at least one test, all flags false, and PRD section references.
- No implementation, billing-generation, database, browser, or PDF tests were run for this design-only assignment.

## Local draft completion and fresh verification (2026-09-05 UTC)

- Preserved the substantial existing draft. Reviewed atomic charge replacement, nullable immutable provenance migration, all-link reads, version-2 calculator/persistence paths, and both contract normalization directions.
- Fixed shared-descriptor compatibility for quote/sales-order item paths and ensured group wrappers expose only evaluator-produced fields. Strengthened real calculator, normalization, mixed-plus-unknown, filter/group and saved document-kind rendering tests.
- Strengthened opt-in production acceptance with a real QuickBooks CSV transform and persisted synthetic service mappings; no outbound delivery. Added exact post-adjustment subtotal/tax/total/applied-credit assertions and a configurable evidence directory. Custom acceptance now requires explicit invoice/template identifiers and checks sorted saved output.
- Existing calculator regression had one stale version-1 assertion; updated it for version 2 and added rate provenance assertions to the existing rounding and override cases. All 41 calculator regression tests passed.
- Fresh generation: four approved entries across two tickets plus usage, five canonical charges, three primary presentation rows, 87500 net and 8750 tax. Source edits leave the full renderer model and canonical accounting export unchanged. Supported manual discount/credit/zero rows reconcile to 86000 net, 8750 tax, 94750 total, and separate 2500 applied credit.
- Live existing-layout UI editing, sort binding, Date column, save/reopen, French canvas/full preview and generated PDF completed. Visual PDF inspection confirms readable rows and localized mixed rates. Existing custom literal headings remain authored text.
- Billing typecheck/build and server typecheck passed. Server typecheck required a larger heap. Full webpack build exhausted its default 8 GB; the isolated 16 GB retry subsequently passed (exit 0), with warnings in unchanged scheduling/workflow modules. Explicit typechecks passed separately because Next skips type validation during build.
- `evidence/README.md` is the reviewer entry point, including precise new/prior artifact paths, commands, mocks and remaining extended matrix. Feature flags describe implemented code; broader test scenarios remain false where coverage is partial. No portal capability is claimed or linked.
- Unrelated lockfile and migration CLI mode modifications remain untouched and excluded. No push or PR is authorized for this draft.

## 2026-09-05 review revisions

- Fixed the three independently reproduced designer probes: language-neutral transform inputs, shared declared alias/row-scope collection resolution, and scalar/missing diagnostics without losing legacy empty behavior.
- Imported collection IDs now survive save/reopen; an explicit source selection clears preservation metadata. Canvas evaluates its supplied node tree and honors authored row prefixes. Print CSS keeps totals intact and repeats table headers.
- Final combined focused/designer/canvas/workspace run: 190/190 (187 committed tests plus 3 supplied probes against the previous generated invoice). The probes were copied temporarily into the server test tree, then removed; no `/tmp`-dependent unit test is committed.
- Repeated actual baseline generation/immutability/CSV/credit/manual-adjustment acceptance. Added real standalone cap plus supported inline additions, multi-tax 74-entry production generation, UI-saved named nested aliases, and four-page French PDF inspection. See `evidence/revision-evidence.md` for exact paths, source/template IDs and mocks.
- Recurring bucket generation independently fails required recurring linkage and rolls back. Contracted recurring project time also loses cap metadata before adjustment. Relevant billing files are byte-identical to reviewed commit d60d83bb96; source/generated evidence is preserved. These are unresolved billing blockers, not successful acceptance runs.
- T006 and T010 now implemented for multi-tax financial behavior and the cap/inline-addition alternative. Broader matrix entries remain false where full approved criteria were not exercised. Named repeating regions were seeded through the supported save action, then columns/transforms were edited, saved and reopened through UI; entirely visual region creation is not claimed.

## September 5 narrow mitigation

- Baseline and ten-gap map: [evidence/mitigation-evidence.md](evidence/mitigation-evidence.md).
- Repaired missing recurring bucket timing, lost project/phase normalization facts and cap application before contract pricing. Fresh source-driven bucket and contracted recurring-cap persistence pass. Authenticated HTTP additionally exposed discarded schedule/period identity keys; schema preservation and validation now pass HTTP generation/read.
- Empty filter output exposed a misleading configure state and missing fields. Shared descriptors now retain evaluated empty output fields; grouped/ungrouped control regressions and live screenshots pass.
- Seven baseline open cases now pass: T003, T004, T007, T008, T013, T017, T019. T009, T015, T016 remain incomplete; see the evidence table for missing producer/authoring capabilities and remaining locale matrix. No broad billing or accounting changes were made to manufacture closure.
- Final focused run: 20 suites / 291 tests. Production generation/persistence: 5 scenarios. Actual authenticated HTTP test: pass. Billing/server typechecks: exit 0 after the final UI repair. Final server build and immutable artifact manifest are recorded in the mitigation evidence.

## Follow-up closure of T009, T015, T016

- Continue from 0ce185f5e3; recurring bucket/cap repairs remain intact. Valid owned task generation now proves distinct same-name identity groups, missing optional labels, mixed services, stable ordering and immutable reads. Real FIFO hour-block allocation and selector-driven generation persist the zero consumption row. Recurring contract periods retain their existing inclusive August 1–31 text/data; prepaid information has no contract configuration-backed detail and remains unchanged.
- Visual invoice-only presets author ordinary editable flat entry sections and repeating ticket-group sections with scoped entry tables. Live insertion exposed page/root compatibility missed by direct-store testing; roots now use sections and the regression exercises DesignerShell's actual insertion handler.
- Canvas now resolves document-referenced headings, table headers and empty states through the same server document localization dictionary as full preview/PDF. Authored literals remain literal; semantic rate filters remain locale-neutral.
- Historical ticketless fallback is explicitly persisted synthetic history, read through the real model/renderers. No orphan ownership policy or producer is added.
- Completed 2026-09-05: live from-scratch designer authoring (fresh Edit-as-Copy `ccf9a9fb`, presets + sixth column + date-desc transform rebind, save/reopen/DB-AST agreement), all six extended production variants, and the 6-fixture × en/fr/zz canvas+preview+PDF closure matrix all pass. Two defects were found and fixed live: `timePresentationLabels` threw for the unsupported-locale fallback (undefined translator — now defaults to authored labels), and the PDF label check needed reading-order extraction because `-layout` interleaves wrapped table columns. Final receipts: focused 21 suites / 293 tests, billing build+typecheck, server typecheck, isolated 16 GB server build — all exit 0. All 19 checklist tests implemented; see `evidence/closure-evidence.md`.

## Independent verification round (2026-09-05, after closure commit aac6f70597)

- No product code changed; nothing required fixing — all ten named cases passed on rerun. Freshly re-executed rather than inherited: 22 files / 296 focused tests including the three original reviewer probes; live+extended production generation (base, cap, recurring-cap, bucket, multi-tax-long, task-identities, hour-block — all regenerated at 20:52Z); the T015/T016 closure matrix against DB template `ccf9a9fb`; the authenticated HTTP spot check (201 generate, wrong-tenant 401) on the relaunched port-3967 server; and all four build gates. Test/typecheck/billing-build receipts all exit 0; the isolated full server build's first attempt was killed by session teardown mid-run, was relaunched session-detached, and completed successfully (73/73 static pages, `BUILD_ID`, no compile errors — durable receipt `server-build-result.json`, verified by the lead after process exit).
- Draft-review failure findings re-proven live: bucket 147500 net with recurring periods reaching `lifecycle_state: billed` and populated charge-detail links; contracted recurring cap billing 20000 with 32500 write-down, 55000 net / 5500 tax, canonical fallback intact.
- Closure evidence spot-checked as real: disclosed-fixture origin markers regenerated, designer-saved template AST in `invoice_templates` re-probed and matching every structural claim, fr/zz locale labels in fresh PDFs, T017 portal artifacts 9/9 SHA-256 match with zero portal-code drift since the walkthrough. See `evidence/verification-evidence.md`; artifact root `/home/robert/alga-artifacts/invoice-ticket-reverify-2026-09-05/evidence/`.
- Env truth for relaunching the wired host server: `next dev` ignores `PORT` from `server/.env.local` (binds 3000) and credential-vault init needs `SECRET_FS_BASE_PATH` pointed at the wirein target's secrets; export both explicitly (recorded as workflow fact).
