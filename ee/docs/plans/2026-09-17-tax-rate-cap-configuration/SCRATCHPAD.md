# Tax rate cap configuration — working notes

## Assignment

- Card: `14e00aa1-7563-48b6-b548-3dc8c447d663`.
- Parent: `8d576a75-24b2-42cd-9758-f6a9e1aa9d76`, PR #3391.
- Planning notes below predate the completed takeover implementation; see VALIDATION.md for current status.
- Worktree is based on the parent implementation; `server/migrations/20260913120000_add_tax_rate_cap_amount.cjs` and the parent contract are present.
- Existing unrelated change: `package-lock.json`; leave untouched.

## Discoveries (2026-09-17)

- The brief's currency premise differs from the checkout: `server/migrations/20251118134500_add_multi_currency_support.cjs` already adds nullable `tax_rates.currency_code`. NULL means universal; an explicit code restricts invoice applicability. TaxService already filters this column on regional/default and period selections. Do not add a duplicate currency column.
- `packages/core/src/lib/formatters.ts` provides currency-aware fraction digits, formatting, and `toMinorUnits`, but conversion currently multiplies a floating-point number and rounds. Exact decimal-string input and maximum-safe formatting need a shared helper extension, not direct reuse of the lossy conversion.
- `CurrencyInput` currently strips invalid characters and calls `parseFloat`; it cannot provide strict malformed-input validation or preserve maximum-safe decimal text as-is.
- `TaxRates` uses the service-catalog translation namespace, a table, a shared add/edit dialog, and Advanced Settings leading to `TaxRateDetailPanel`. Put cap editing beside the percentage and summarize cap state in the table and details.
- `calculateCompositeTax` sums components without applying the row cap; regional selection uses row percentages and cap contributions. Composite copy must not promise a cap on component totals.
- The existing action cap error lacks a translation key. `getTaxRates` returns raw PostgreSQL rows, including bigint strings despite the numeric public interface.

## Sources inspected

- `docs/billing/tax/tax_caps_and_period_spanning.md`
- `packages/billing/src/components/billing-dashboard/TaxRates.tsx`
- `packages/billing/src/components/billing-dashboard/TaxRateDetailPanel.tsx`
- `packages/billing/src/actions/taxRateActions.ts`
- `packages/billing/src/services/taxService.ts`
- `packages/types/src/interfaces/tax.interfaces.ts`
- `packages/core/src/lib/formatters.ts`
- `packages/ui/src/components/CurrencyInput.tsx`
- `server/src/lib/api/schemas/financialSchemas.ts`

## Final planning decisions

- Reuse existing `tax_rates.currency_code`; require an explicit supported currency for new/changed caps, including zero. No migration/backfill guesses. Existing unresolved caps preserve their semantics and remain inspectable/clearable.
- Put cap/currency after percentage in the add/edit form; add a Tax cap column and Details readout. Main dialog owns editing. No enable toggle.
- Composite row caps remain configurable with a persistent warning: regional row contributions use them, component-based default totals do not. Do not change parent component arithmetic.
- UI uses exact major-unit decimal strings; actions/API use safe integer minor units. Extend shared money helpers instead of copying project cap parsing or using permissive CurrencyInput.
- Public schemas expose cap/currency now. No new POST/PATCH endpoints. GET must return actual tax rates, with normalized cap values.
- Preserve existing jurisdiction, period, rounding, and coverage questions. The plan describes implementation behavior and does not grant domain approval.
- The human explicitly ordered a completed plan for this card. Produced all four artifacts within that scope; no product implementation, board transition, approval, or merge performed.

## Additional integration discoveries

- `server/src/app/api/v1/financial/tax/rates/route.ts` calls generic `ApiFinancialController.list()`. `FinancialService` extends BaseService with tableName `transactions`; imported tax schemas are not implemented tax CRUD methods. The plan includes correcting this GET response, not claiming nonexistent public create/update endpoints.
- Manual invoice `services/invoiceService.ts` passes currency to TaxService. Callers in `actions/invoiceGeneration.ts` and `actions/billingAndTax.ts` omit it, so explicit-currency rates need bounded caller changes.
- `lib/billing/compute/taxContext.ts` has a second regional tax calculation without cap in `LoadedChargeTaxRate`. The plan requires loader/model propagation and sharing the parent's pure regional helper rather than rebuilding its arithmetic.
- `validateTaxRateDateRange` currently checks overlap by region regardless of currency. Keep the rule, document the limitation, and do not promise concurrent per-currency rate authoring in one region.
- Shared `CURRENCY_OPTIONS` contains JPY but no three-digit currency. `CurrencyPicker` accepts custom options. Plan validated metadata/options that support BHD without globally changing unrelated picker behavior.
- `normalizeTaxCapAmount` currently calls Number on strings; fractional text that rounds to an integer and alternate numeric syntax need strict lexical guards at boundaries to satisfy the input contract.
- Main screen currently always offers mutation controls; detail panel already accepts `isReadOnly`. Plan permission presentation and verify server-side denial independently.

## Original planning validation and handoff

- Plan size: 30 implementation features, 25 representative tests; all `implemented: false`.
- No live smoke or product tests run in this planning assignment. Live evidence is an implementation requirement, not evidence already obtained.
- Existing parent test anchors: `packages/billing/tests/tax/` and `packages/billing/src/services/taxService.rateSelection.db.test.ts`.
- Validate plan structure: `python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-09-17-tax-rate-cap-configuration`.
- Run `git diff --check` and check feature/test IDs, cross-references, and untested features before handoff.

- Validation completed: plan validator passed (30 features / 25 tests); unique IDs, PRD references, full feature-to-test mapping, and false implementation flags checked. `git diff --check` passed. New plan files also checked for trailing whitespace. The pre-existing package-lock.json modification remains untouched.

## Takeover implementation (2026-09-17)

- Two builder harness failures left only the local plan. Root implemented with bounded API, invoice, and locale workstreams under the swarm skill.
- Retrieved/read Design Session review packet from the hub using the full run UUID 38171fb3-d255-4672-af94-075fe398e0bb. The packet was based on an unreachable checkout; local PRD corrections D1/D4 are verified against the migration and composite method and explicitly required by the takeover instruction. Retired stale currency/composite dossier facts.
- Existing nullable currency column is reused. Exact decimal-string/BigInt helpers added to core, no existing lossy money caller changed. Currency metadata uses Intl.supportedValuesOf with shared picker fallback.
- Tax Rates now exposes currency/cap controls, clear, exact legacy resolution, list/details, permission-gated editing, and localized contextual help. Actions and GET normalize bigint strings and preserve missing/null/zero.
- Parent regional arithmetic extracted and reused by preloaded billing and simulator paths; bounded currency propagation fixes maintain explicit invoice/contract currency.
- Live/test databases lacked cap_amount despite code ancestry. Applied only existing 20260913120000 migration with named migrate.up; no new migration or guessed cap backfill.
- Verification: 287 combined component/calculation tests, 60 DB tests, 22 API/delete unit tests; billing build/typecheck passed. Full server typecheck passed with NODE_OPTIONS=--max-old-space-size=12288 (default heap exhausted first). CE and EE OpenAPI generation passed; generated SDK updates scoped to tax GET schemas. Locale validator passed without warnings.
- Live invoice generation initially failed because the shared dev database lacked inherited numbering and invoice charge/snapshot migrations. Applied those existing additive migrations; the full set/edit/clear/zero manual invoice smoke then passed. No cap configuration used direct SQL.
- Private credentials and fixture scripts live under /tmp; never commit them. Durable evidence directory: /tmp/alga-smoke-evidence/tax-cap-ui-20260917.

## Final verification

- All 30 features and 25 test entries now have implementation/evidence records. See VALIDATION.md for exact execution scope and limitations.
- Final focused UI/money/compute tests: 89 passed. Final DB action/API/parent/real recurring draft tests: 69 passed. Community and EE environment action/schema subsets: 16 each against the same migrated DB.
- Live UI state persisted as 500, 300, NULL and 0; equivalent USD100 taxable draft totals had tax500,300,1000,0. A second-region invoice with two USD5 caps had taxUSD10 on USD200, proving it is not an invoice-wide cap. Same-region charges group before calculation.
- Fixed two issues found by live testing: Edit Escape/Cancel/Save now restores the stable row menu trigger; rows wait for permission loading before becoming interactive.
- Scope remains explicit rate currency, preserved legacy unresolved caps, and unchanged composite component calculations. The tenant-base-currency and composite claims in the earlier packet were superseded by verified local PRD decisions.
- Pre-existing package-lock.json modification remains excluded from the implementation commit. No push or PR publication.
