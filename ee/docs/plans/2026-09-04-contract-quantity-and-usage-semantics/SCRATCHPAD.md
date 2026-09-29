# Scratchpad — Contract quantity and usage semantics

- Created: 2026-09-04
- Scope: revised design; implementation has not been completed against this revision.

## Decisions

- The user authorized updating the plan from the design review without another interview. This revision supersedes the original XO design packet where they differ. This planning session does not advance the workflow or mutate customer billing data.
- Recurring seats use explicit quantity-times-unit-rate pricing on Fixed lines, without usage records. Existing fixed bundle prices retain their own semantics.
- Usage remains record-driven. Distinguish additive consumption entries from one replaceable period total. A period total does not carry forward.
- Preserve existing additive entries and their per-entry minimum/tier behavior. Period totals apply minimum/tiering once to the effective total. Never silently reinterpret legacy entries or minimums.
- Recurring quantity/rate changes and mode transitions take effect at a displayed next unbilled service-period boundary. Mid-period seat true-ups are outside this revision.
- Currency totals stay separate by currency; no implicit FX conversion.

## Evidence and constraints

- Original design existed as the XO Design Session review packet, not a committed plan folder. Source run: `4d5f6407-50c8-48a3-80cc-5360d2c4534e`; workflow card: `ce36c216-6319-41f9-a523-a89a6de4b8db`. These are workflow identifiers, not customer record IDs.
- `computeUsageBasedCharges.ts` maps each record to a charge and applies minimum/tiering inside the map. Two entered counts are currently additive.
- `computeFixedCharges.ts` prioritizes a line-level rate over a quantity-derived total; quantity fallbacks also use `|| 1`. Verify explicit unit pricing and zero quantities rather than assuming existing Fixed lines implement the seat workflow.
- `AutomaticInvoices.tsx` deep-links only client/service filters. `UsageTracking.tsx` resets Add Usage fields and defaults its date to today. Carry period and attribution into the form itself.
- `billingEngine.ts` identifies missing usage from uninvoiced records, which cannot distinguish never-recorded from already-invoiced usage without a separate diagnostic query.
- `contractActions.ts` suppresses legacy usage quantities; the revised requirement is a visible non-billing reference.
- Contract reports still sum line-level rates and format summary values in tenant currency. Variable-usage flags alone do not establish correct fixed-unit MRR or mixed-currency aggregation.
- Branch baseline includes `94d3ec96e8` and follow-ups through `b867c21c2b`. Latest card facts report successful date/selector checks; the older smoke summary remains failed. Neither proves the new period-total and recurring-seat requirements.

## Implementation sequencing

1. Add explicit pricing/measurement semantics and effective-period boundaries with compatibility guards.
2. Implement recurring unit commitments and period-total persistence/charge consumption, including concurrency and retry guards.
3. Connect intent selection, legacy transition, and period-prefilled recording flows.
4. Finish typed diagnostics and shared currency-aware recurring-value calculation.
5. Execute the DB-backed and UI acceptance matrix in `tests.json`.

## Validation

- Run the alga-plan `scripts/validate_plan.py` against this folder.
- All revised checklist items initially remain false: verify existing partial implementation against the complete revised criterion before marking it complete.
- Use isolated development/test data only. No customer-account changes or retrospective invoice generation are part of this plan update.

## Open questions

- No product decision blocks this revision. Resolve concrete schema reuse against the existing recurring-period model without weakening replacement, uniqueness, attribution, or historical-billing requirements.

## Implementation round status (2026-09-04, Draft Implementation)

Durable record of what the Draft Implementation round changed and verified. Features/tests flags in `features.json`/`tests.json` are the authoritative per-criterion truth; this section records where the evidence lives so a reviewer does not re-derive it.

### Done and DB-verified (isolated fixtures; no customer data touched)

- Migration `server/migrations/20260904100000_contract_quantity_usage_semantics.cjs`: explicit `measurement_mode` (usage config, legacy `additive` default) and `pricing_basis` (fixed config, legacy NULL = bundle); new `usage_period_totals` and `contract_line_unit_pricing_revisions` stores with DB uniqueness and non-billable rollout.
- Period totals: `packages/billing/src/actions/usagePeriodTotalActions.ts` (create/replace/delete/get with request-id replay, logical-key replacement, revision/stale guards, billed-immutability); engine consumption in `billingEngine.ts::loadUsageBasedObligation` (additive vs period-total split, typed statuses) + `computeUsageBasedCharges` (period-total charge identity) + `invoiceService.ts` single-consumption lock and draft-void release.
- Recurring seats: `pricing_basis='unit'` Fixed lines bill quantity × unit rate with no `||1` fallback and no bundle line-total precedence (`computeFixedCharges` unit branch, `billingEngine` loaders carry `pricing_basis` through the domain facts layer); `contractLineUnitPricingActions.ts` schedules effective-boundary revisions honored by the engine; `contract_line_unit_pricing_revisions` rows keep earlier billed periods untouched.
- Mode/basis read path and guard actions: `contractLineSemanticsActions.ts` (mode conversion blocked while unbilled entries/recorded totals exist), additive-write rejection into period-total configs in `usageActions.ts`.
- Diagnostics: usage statuses now distinguish `missing_usage`/`unreported`, `explicit_zero`, `minimum_raised_zero`, `already_invoiced` (with evidence fields) and are surfaced by the invoice preview; `AutomaticInvoices.tsx` renders actionable vs already-recorded evidence separately so already-invoiced periods never prompt duplicate recording.
- Reference read path: `getContractOverview` returns `previouslyConfiguredQuantity` for Usage services and `ContractOverview.tsx` renders it as non-billing reference data.
- DB-backed behavioral suite: `server/src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts` (17 tests) — seat journey 189000 → scheduled 209000, period-total replacement/replay/concurrency/regeneration/min-once/explicit-zero/unreported/billed-immutability, additive preservation, wrong-mode rejection.

### Known gaps this round (leave related flags false; see draftSummary)

- No authoring UI yet for choosing "recurring seats / period count / additive" intents (F001/F003), no period-total/period-prefilled entry form in Usage Tracking (F012–F014), no wizard/template/preset editors for the new basis/mode.
- Stale-preview enforcement at generation (approval shows revision X, generation consumes exactly X) is not implemented; generation recomputes from current DB state exactly as additive usage does today.
- Mixed-invoice omission acknowledgement and automated-run incomplete-usage reporting (F016) are not implemented.
- Per-currency recurring-revenue reporting (F018–F020) and the legacy-transition authoring journeys (F021–F023) are not implemented.
- Additive request-id retry protection is not implemented (additive entries have no request identity).
- No live browser smoke was run on port 3748 this round; verification is DB-backed + jsdom only.

### Reviewer first-stop

`billingEngine.ts` usage/fixed loaders and the domain facts threading in `calculateContractCharge.ts`; the period-total consumption lock in `invoiceService.ts::linkAndMarkSourceBillingRecord` and its draft-void release in `invoiceModification.ts`; `usagePeriodTotalActions.ts` replay/revision semantics.

## Round-3 status (2026-09-04, Draft Implementation takeover)

Three parallel workstreams landed together; the integrated tree is fully verified (billing vitest 1180 passed/38 skipped, billing+shared+server tsc clean with the server memory flag, DB suites 41/41: contractQuantityUsageSemantics 28, usageRecordDrivenBilling 7, usageAddFlowOverlappingBucket 1, contractRecurringValueReporting 5, server unit report/UI/run suites 32/32).

### Reporting (F018–F020, T011)

- `shared/billingClients/contractMonthlyValue.ts` is now the canonical recurring valuation: `getContractMonthlyFixedValuesByContract` (unit lines Σ qty × rate with the latest `contract_line_unit_pricing_revisions` row effective at/before the as-of date; future revisions excluded; bundles keep the line rate; every line cadence-normalized via `normalizeToMonthlyCents`) plus the assignment rollup and `aggregateCentsByCurrency`.
- Consumers: `getContractOverview` (non-template `totalEstimatedMonthlyValue`), `contractReportActions` revenue/expiration rows (now carry `currency_code`), and the summary — `ContractReportSummary.totalMRR/totalYTD` were REPLACED by `fixedMrrByCurrency`/`ytdRevenueByCurrency` (active-assignments-only MRR, per-currency, no cross-currency sums). `ContractReports.tsx` renders per-currency tiles ("Fixed MRR"), row-currency amounts, and pure-usage rows as "Variable usage" instead of a fixed zero. New msp/reports.json keys in all 10 locales.
- DB proof: `server/src/test/infrastructure/billing/invoices/contractRecurringValueReporting.test.ts` (5 tests, incl. the 10/9/1 → 189000 example and CAD/USD separation).

### Engine safety (F009, F015, F016; T005, T007, T008)

- Stale-preview lock: preview statuses carry the period-total `revision`; `generateInvoice*` accept `IInvoiceGenerationRequestOptions.expectedUsagePeriodTotals` and refuse coded `USAGE_PERIOD_TOTAL_STALE` when the stored revision changed/was deleted/billed; no expectation → legacy recompute. Consumption stays the conditional recorded+revision UPDATE in `invoiceService.ts`.
- Diagnostics: `attribution_excluded` and `calculation_error` are now distinct typed statuses (never conflated with unreported); missing-usage advice is built only from genuinely unreported services.
- Mixed-invoice ack: charges + unreported usage fail coded `USAGE_RECORDS_MISSING_ACK_REQUIRED` unless `acknowledgeUnreportedUsage`; acknowledged generation omits the usage and leaves the obligation billable later exactly once; automated recurring runs report an actionable incomplete-usage failure instead of silently finalizing. `AutomaticInvoices.tsx` renders the ack dialog; 13 new msp/invoicing.json keys × 10 locales. 9 new DB tests in contractQuantityUsageSemantics (28 total).
- Deliberate behavior changes: zero-charge unreported windows fail coded at generation (no $0 invoice), and whole-document "missing pricing" throws became per-service `calculation_error` statuses (generation still refuses).

### Authoring UI (F001, F003 partial, F010, F021, F023; T014 partial)

- `UsageServiceConfigPanel` has the additive vs period-total measurement-mode choice with add/replace/carry-forward explanations and mode-scoped minimum labels; `FixedServiceConfigPanel` has bundle vs recurring-seats pricing basis with a live N × rate summary; `ContractLineServiceForm` routes mode changes through `setUsageMeasurementMode` (guard reused, generic update cannot bypass it); `upsertPlanServiceConfiguration` accepts `measurement_mode` through the same guard.
- `ContractOverview` names the quantity source per intent (unit "N × rate (recurring seats)", bundle "allocation — not billable seats", usage per mode) and the legacy-quantity reference offers "Set up recurring seats" / "Report a period count" via the new `UsageLegacyTransitionDialog` (open/cancel writes nothing; period-count confirm goes through the conversion guard; recurring seats is a reviewed handoff, not an atomic transition). New keys in msp/service-catalog.json + msp/contracts.json × 10 locales; 10 new jsdom tests in packages/billing/tests.

### Still open (flags false)

- F003 remainder: wizard/preset/template intent selection and the contract-lines editors translating from msp/contract-lines.json / msp/billing.json (deliberately reverted to respect locale-file boundaries; `upsertPlanServiceConfiguration.measurement_mode` has no UI caller yet).
- F005: revision scheduling has no UI displaying the next unbilled boundary (server path proven).
- F012–F014: preview shortcut create-vs-edit, multi-service chooser, additive period carry, return-to-preview.
- F022: atomic recurring-seat transition (close source + activate destination).
- F025 / T009 / T015: no live browser smoke this round — the dev-stack `server` DB has not run migration 20260904100000 (see card facts); run it before smoking period totals/unit pricing on 3748.
- T010, T012–T014: not fully proven.

### Reviewer first-stop (this round)

`assertExpectedUsagePeriodTotalsCurrent` + the generation guard ordering in `invoiceGeneration.ts`; the `calculation_error` pre-validation in `billingEngine.ts` (it withholds unpriceable rows instead of throwing); the summary-shape change in `contractReportActions.ts` (totalMRR/totalYTD removed — check downstream consumers outside this repo, if any).

## Failed-review mitigation at 38bcf937 (2026-09-04/05)

Repairs the existing implementation and preserves the task-related changes already uncommitted at takeover. Root/ancestor AGENTS.md was absent; coding standards and this revised plan were read. Earlier round notes above are historical.

### Review first

- `invoiceGeneration.ts`, `usagePeriodTotalIdentity.ts`, recurring run actions and Automatic Invoices: single/grouped expectations preserve every selector and bridge, bind persisted report ID/revision plus billing inputs and priced outcomes, include absent reports, and reject stale finalization. Calculation and consumption share one transaction. `billingMutationLock.ts` and migration 1300 serialize tenant billing mutations; the lock-table write reaches the tenant shard as well as the coordinator.
- `usagePeriodTotalActions.ts` and migration 1200: durable accepted request history; replay A after B returns current B without writing; changed content conflicts. Replacements require request ID/current revision, DELETE requires current revision, and creation uses ON CONFLICT DO NOTHING rather than querying an aborted transaction. Independent-connection tests observe a concurrent price writer waiting in PostgreSQL until invoice consumption commits.
- `seatRevisions.ts`, configuration service and both normal service editors: displayed effective boundary, transactional prospective seat writes, historical invoice/period protection, and effective revision reads. Fixed computation retains unit charges alongside legacy bundle allocations. Pricing basis remains per configuration.
- `usageMeasurementTransitions.ts` and migration 1400: dated measurement/pricing snapshots commit together, the engine resolves mode for the actual period, and affected usage/invoice conflicts reject the transition. Failed validation leaves baseline pricing/revisions unchanged. Overview/configuration reads reflect effective modes and seat revisions; legacy quantities remain audit metadata.

### Other repaired production paths

Server entry validates configuration/membership, effective active client assignment and engine-derived/materialized coverage. Advance/arrears, invalid boundaries and inactive/future/ended assignments have database coverage. Client-owned contract eligibility follows assignment lifecycle, not the reusable header's legacy active flag.

Usage Tracking and the shared period-total form preserve client/line/config/service/period, convert inclusive billing dates once to half-open filters, distinguish create/correction including zero, retain additive retry IDs, and return to the same preview. Missing-only inline entry and all-error diagnostics have rendered component coverage. Shared recurring valuation uses invoice catalog fallback, mixed bundle/unit pricing, Usage-config detection independent of parent type, effective revisions, cadence normalization and separate currencies. New labels use translation keys; untranslated locales receive English fallback and pseudo-locales retain fill markers.

### Verification

- Four infrastructure suites (`contractQuantityUsageSemantics`, `contractRecurringValueReporting`, `usageRecordDrivenBilling`, `usageAddFlowOverlappingBucket`): **63/63 passed**, including production overview reads after effective revisions, single/grouped recurring submission, real concurrent connections, replay, attribution and consumption. PostgreSQL 5472; isolated TEST_DB_NAME=quantity_mitigation_20260904_final; credentials read from secrets without printing them.
- Billing package: **1,194 passed, 38 skipped** after final translation extraction and locale-schema validation. Server run/page/report suites: **24/24 passed**. Billing/shared/server TypeScript passed; server heap limit 24576 MB. Final production build passed (exit 0), with nonfatal webpack/static-render warnings; independent typechecks were run because the Next build skips type validation.
- Translation validator: **0 errors, 0 warnings** across nine non-English/pseudo locales.

### Focused live smoke and cleanup

Port 3748 was initially down. A board restart was requested, then the worktree service was started from `server` with PORT=3748 npm run dev against the existing infrastructure. Only missing feature migrations 1100–1400 were applied; no usage backfill or historical charge changes.

Synthetic tenant only: overview showed USD 1,000 fixed plus variable usage. Normal Contract Lines editing saved 12 seats effective October 1 while baseline stayed 10. August preview recorded total 10 then corrected it to 12 (subtotal USD 1,100 to 1,120). Consumption navigation opened August with exact client/line/service/config; additive entry 4 returned to the same grouped preview at USD 1,140. A same-amount minimum change after preview was rejected by live Generate Invoice as stale. Fresh generation created one draft: subtotal 114000, tax 11400, total 125400 minor units; total revision 2 and one additive request consumed, expected billing profile and all three configuration/service-period attributions preserved. Reports showed USD 1,000 Fixed MRR plus variable usage and excluded the draft from billed YTD.

The synthetic tenant and all its tenant-scoped records, including invoice, usage, revisions, settings and permissions, were removed. No Samuel Braun/customer account was changed and no customer invoice was created. Durable workflow facts were recorded throughout.

### Remaining wider-plan work and limits

F003 (full wizard/preset/template authoring), F022 (atomic Usage-to-Fixed source/destination transition), F025 and the broader T009/T010/T012/T014/T015 matrices remain false where their complete text exceeds this verified mitigation. The legacy recurring-seat dialog remains a handoff. Focused live coverage spans configuration, overview, tracking, preview/generation and reports; it does not claim the entire two-period/legacy-transition live matrix. Citus worker deployment was not exercised; local PostgreSQL concurrency is proven. Tenant billing serialization is coarse and has not been load-tested. Request IDs discarded before durable history cannot be reconstructed; no historical data was invented.

## Review follow-up to 03ad70eba0 (2026-09-05)

All four independently reported failures were reproduced in permanent PostgreSQL tests before the repair (four failures; `/tmp/quantity-followup-red.log`).

- First same-mode pricing edits now persist a complete dated pricing snapshot. January's 4 units remain 4000 cents after a February 1 rate change; February bills 8000 cents. Baseline pricing is unchanged.
- Mode-only transitions and partial edits inherit the applicable snapshot at their boundary, including custom/base rates, minimums, unit labels and tiers. Future snapshots cannot leak backwards. Explicit null, zero, false and empty tiers remain edits. Older mode-only rows with null pricing resolve the latest prior explicit snapshot without a data backfill. Production invoice tests verify 8000-cent inherited pricing, 18000-cent minimum/tier pricing and 4000-cent catalog fallback after explicit clearing.
- Deleting a pre-history live report preserves its known request identity transactionally before removing the report. Identical and changed-payload replay cannot recreate it; preview/generation remain missing-usage with no invoice. This uses the live identity only, without synthesizing usage or reconstructing unavailable request history; migration 1200 does not need rerunning.
- Quantity-only additive corrections reuse the canonical stored-date normalization for measurement revision lookup. A real PostgreSQL Date is accepted, and the corrected 5 units invoice at 5000 cents.

Verification: four infrastructure suites passed **71/71** tests, including eight new behavioral cases, on PostgreSQL 5472 with isolated `TEST_DB_NAME=quantity_review_followup_final_20260905`. The full billing package passed **1194 tests, 38 skipped**; server run/page/report suites passed **24/24**. Billing/shared/server TypeScript checks passed, including the final server check with a 24576 MB heap. The final eight-case PostgreSQL rerun also passed; the final unchanged-source production build passed (exit 0), with nonfatal webpack dynamic-dependency/cache and static-render warnings. Next skips type validation, so all three independent TypeScript checks were run. No customer accounts or live invoices were changed in this follow-up. Wider-plan completion flags remain unchanged.

Review `usageMeasurementTransitions.ts` and the configuration service's partial pricing payload first, then the transactional delete history and canonical additive date fixes. The permanent regressions are in `contractQuantityUsageSemantics.test.ts`.


## Active UI recovery (2026-09-05)

Starting HEAD: `dde3e81954fa8e2c32fc2e8792f288d61bb37636`. Work stays in the existing feature checkout. No production/customer data or workflow-board state was changed.

- The normal route is Contracts → open contract → Contract Lines → Create Custom. That dialog now renders the shared Usage and Fixed semantic panels. Usage saves explicit additive/period-total measurement, minimum and tiers. Fixed saves bundle/unit basis, agreed quantity (including zero), unit rate and partial-period settings. Unit summaries use the contract currency; an all-unit line has no hidden bundle total. Each service has independent radio/input identifiers.
- The creation action, configuration service and configuration models previously dropped semantic fields. They now persist those fields together; new Usage configurations have no configured quantity. Creation validates explicit recurring quantity/rate before creating any rows.
- Contract Lines → Edit now loads Usage settings at the displayed effective boundary, including scheduled rates, minimums and tiers. Save uses `updateConfiguration`, whose existing transactional service delegates to `setUsageMeasurementModeInTransaction`. Previously invoiced lines permit prospective Usage edits while preserving line settings and membership. Changing the boundary reloads its effective prices; blank required boundaries block Save, and rejected transitions keep their actionable error.
- Usage tiers follow boundary changes, including clearing a prior tier schedule. New service memberships carry selected tiers. Legacy recurring-seat guidance explains separate Fixed commitment creation without claiming an atomic source conversion or a next-period start.
- Full wizard/preset/template parity and atomic Usage-to-Fixed conversion remain outside this recovery. Existing broader incomplete flags stay false. Added F026–F028 and T016–T018 describe this verified scope.

Validation uses rendered components with action spies and the production actions against migrated, isolated PostgreSQL at `127.0.0.1:5472`. Databases: `usage_ui_recovery_20260905` and `usage_ui_recovery_final_20260905`; credentials were read from local secret files without printing them. No live product-browser smoke or production build was run in this recovery.

Evidence:

- `/tmp/usage-ui-tests.log`: seven focused billing UI/action suites, **33 passed**. Includes Create Custom, active Contract Lines editing, existing service editors, membership/preset compatibility, and the legacy overview handoff. Tests assert behavior and submitted values rather than source strings.
- `/tmp/usage-ui-db-tests.log`: full quantity/usage infrastructure suite, **63 passed**, including six new production-action persistence/effective-boundary cases and the existing invoice, retry, concurrency and history regressions.
- `/tmp/usage-ui-db-focused.log`: final six-case persistence rerun, **6 passed**, additionally asserts new Usage configuration quantity is NULL.
- `/tmp/usage-ui-typecheck.log` and `/tmp/usage-ui-server-typecheck.log`: billing and server TypeScript checks passed. Server used `NODE_OPTIONS=--max-old-space-size=24576`; both used `--noEmit --incremental false`.
- Plan validation and `git diff --check` passed.

The filesystem filled during editing. The interrupted action file was reconstructed from the starting commit plus the intended patch. Generated Next dev cache was moved to `/tmp/usage-ui-recovery-next-cache-20260905`; source diff and tests were rechecked after recovery. Existing runtime/database fixes remain in place.

## Pre-effective recurring-gap deploy mitigation (2026-09-05)

Starting HEAD `db45cf809b`, clean worktree; revised plan present. Read ancestor instructions and coding standards; no worktree AGENTS.md files. Scope is only recurring gap discovery and repair.

Root cause: Create Custom synchronizes through `computeClientCadenceRegeneration`, which starts each line at max(assignment start, client-wide billed/detail-linked service-period end). There is no separate client-line effective-date column in that calculation, and `created_at` is not an eligibility rule. Discovery used assignment overlap and then a schedule-local historical filter, missing the sibling ledger boundary for newly added Fixed/unit and Usage/period-total lines.

Permanent PostgreSQL regressions reproduced four failures before product edits (`/tmp/recurring-gap-red.log`): each model displayed September despite canonical October materialization, and deleting October yielded four gaps instead of two. Both individual and bulk repair already respected the client ledger; the tests also protect stale direct schedule submissions and repeated repair. Draft-linked records have lifecycle `billed` even while their invoice is a draft.

Implementation shares `loadClientBilledLedgerBoundary` and `resolveClientCadenceObligationStart` between materialization, discovery, and individual repair (bulk already uses canonical regeneration). Discovery applies the existing advance/arrears window predicate with the canonical start, retaining assignment-end overlap. Individual repair now uses canonical assignment clipping like bulk repair. No pricing, usage, migrations or historical billing data changes.

Verification so far:

- `/tmp/recurring-gap-green.log`: four new DB behavioral cases passed after four pre-fix assertion failures. PostgreSQL at 127.0.0.1:5472, unique `TEST_DB_NAME` values `recurring_gap_red_20260905`, `recurring_gap_green_20260905`, and `recurring_gap_full_20260905`; credentials loaded from worktree secrets without printing them.
- `/tmp/recurring-gap-db-full.log`: quantity/usage **67/67** and client recurring replenishment **6/6**. The additionally selected anchor suite exposed stale fixture assumptions: a removed client-line assignment ID instead of the canonical contract-line ID, eager fixture materialization, and expecting obsolete bridges to remain active. Corrected those test fixtures/assertions, preserving regeneration assertions. `/tmp/recurring-gap-anchors-verified.log`: **7/7**. No anchor production behavior changed.
- `/tmp/recurring-gap-ui-final.log`: server AutomaticInvoices, individual repair, client cadence generation/materialization, and timing predicate suites **55/55**. The grouped-preview test now checks actual supported grouped selector submission instead of removed unavailable-copy.
- `/tmp/recurring-gap-auto-package.log`: package AutomaticInvoices grouped rows, duplicate identity, PO dialog, and i18n suites **56/56**.
- Billing/shared/server TypeScript passed (`/tmp/recurring-gap-{billing,shared,server}-tsc.log`), server heap 24576 MB.
- Broader optional runs are not wholly green: package `npm test` reports **1198 passed, 5 failed, 38 skipped**, involving existing usage-config persistence mock and contract translation/source-string checks. The wider server-config package sweep reports 23 failures (2347 passed), including alias/environment-sensitive authoring mocks and optional accounting DB tests; this is not the package's normal runner. These are outside the deploy-fix, not claimed as passing. Pseudo-locales rewritten by the existing generator tests were returned to their starting content; no unrelated translations are included.

Live smoke on the existing worktree dev-server service at port 3748 used a newly created synthetic tenant and a separate authenticated browser context. A September 1 monthly assignment and September draft-linked sibling ledger boundary were seeded with Fixed/unit and Usage/period-total lines. Applying September 1–December 31 showed only October repair warnings. Fix all filled eligible schedules; the refreshed list showed October, November and December candidates, $110 fixed plus variable usage (including the synthetic existing sibling). Database checks proved both new lines first start October 1 with one row per period, zero usage records/totals, and the original draft only. Removing only the synthetic new schedules and opening their direct Service Periods URLs let normal individual Repair Missing Service Periods rebuild each from October, never September. Screenshots: `/tmp/recurring-gap-live-{eligible-october,october-candidates,individual-repair}.png`. All synthetic tenant-scoped records and the tenant were then deleted and absence verified. No customer account was mutated.

The five broader package failures were also reproduced from an archived clean starting HEAD (`db45cf809b`) under `/tmp/recurring-gap-baseline-20260905` with the package runner (`/tmp/recurring-gap-baseline.log`). That baseline had one additional pseudo-locale timing failure; all five current failures match baseline. The usage mock rejects the existing additive measurement-mode field, and the remaining checks concern prior authoring translation keys/source text. These are pre-existing, not caused by the boundary mitigation.

Live cleanup completed: the synthetic tenant and every tenant-scoped record were removed, and the absence of the tenant was checked. The running dev-server service and customer data were left intact.

Final required-suite evidence: additional contract materialization, backfill, regeneration, assignment clipping and non-contract AutomaticInvoices suites passed **21/21** (`/tmp/recurring-gap-extra-domain.log`). Together the selected database and UI/domain checks cover **212 passing tests** (80 DB, 76 server UI/domain, 56 package AutomaticInvoices). Server production build passed **exit 0**, using `NEXT_DIST_DIR=.next-gap-build` to keep the running dev service usable and a 24576 MB heap (`/tmp/recurring-gap-build.log`). Nonfatal webpack/cache and dynamic-render warnings were present; Next skips type validation, so independent typechecks were run.

Reviewer first stops: `clientCadenceScheduleRegeneration.ts::loadClientBilledLedgerBoundary` and `resolveClientCadenceObligationStart`, then `billingAndTax.ts::fetchClientCadenceMaterializationGaps` (canonical start passed to the existing timing predicate), and `recurringServicePeriodActions.ts::repairScheduleMaterialization` (current tenant boundary and assignment clipping). Bulk repair continues through `computeClientCadenceRegeneration`, sharing the same resolver and billed-history backfill guard. Wider-plan incomplete flags remain unchanged. No migrations, contractual repricing, retrospective invoices, synthesized usage, push or PR.

The final server TypeScript rerun also passed (`/tmp/recurring-gap-server-tsc-final.log`, 24576 MB heap). Production output was moved outside the source tree to `/tmp/recurring-gap-production-build-20260905`; the ignored Next environment declaration was returned to the running dev server's route declarations. Final diff hygiene and plan validation passed.
