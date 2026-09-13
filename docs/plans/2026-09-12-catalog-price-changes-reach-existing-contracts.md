# Catalog price changes reach existing contracts

**Card:** 8939ad61-7f5c-4b63-b52e-4a57a1af29bb
**Branch:** `feature/catalog-price-changes-reach-existing-contracts-r`
**Date:** 2026-09-12
**Round one scope:** fixed / recurring rates. Hourly and usage rate *provenance* deferred; hourly/usage *catalog* reads are touched only because they share the resolver (see Piece 0).

---

## 0. What the audit changed

Five of the brief's stated facts are wrong or incomplete. The design below is built on the verified
picture, not the briefed one. Each correction is load-bearing.

| # | Brief said | Verified | Consequence |
|---|---|---|---|
| 1 | `contract_pricing_schedules` is half-wired; "THE BILLING ENGINE DOES NOT READ IT"; it "changes zero dollars on zero invoices" | **False.** The engine reads it at `billingEngine.ts:3802` (batched) and `:4118` (per-line), selects the active row at `:327-337`, and applies it at `:4133-4142` with `customRateSource = "pricing_schedule"`. It has full CRUD (`contractPricingScheduleActions.ts:143/231/333`), production UI (`PricingSchedules.tsx`, `PricingScheduleDialog.tsx`, mounted from `ContractDetail.tsx:2632`), i18n in all 10 locales, and DB-backed tests (`pricingScheduleRateOverrides.test.ts`). | The "flesh it out and make billing honour it" instruction is already done. The real questions are scope (contract-wide) and duplication. See Piece 2. |
| 2 | Rate precedence is `contract_lines.custom_rate` → *client contract line* `custom_rate` → `service_base_rate` → `service_catalog.default_rate` | Step 2 is **dead**. `client_contract_line_pricing` and `client_contract_lines` were dropped (`20251207140000_drop_redundant_client_contract_tables.cjs:36,39`). `clientContractLine.custom_rate` is an alias of the *same* `contract_lines.custom_rate` column (`billingEngine.ts:3051,3071`), so step 2 can only fire when step 1 is null, and then it is null too. | The chain is 3 real steps, not 4. `docs/billing/billing.md:185` is stale and must be corrected. |
| 3 | Effective-dating has one mechanism to flesh out | There are **four** contract-side rate mechanisms already: `contract_pricing_schedules` (contract-scoped, effective-dated), `contract_lines.custom_rate`, `contract_line_unit_pricing_revisions` (per-member, effective-dated at service-period boundaries, `20260904100000`), `contract_line_service_fixed_config.base_rate` (per-member snapshot). | Adding a fifth would be malpractice. See Piece 2's verdict and the resolver in Piece 0. |
| 4 | Entry point is `ServiceForm.tsx` | `packages/billing/src/components/billing-dashboard/ServiceForm.tsx` is **dead code** — not mounted anywhere; its only references are two static guard tests (`onboardingServiceTypeDecoupling.static.test.ts:14`, `hardCutoverDebtGuard.static.test.ts:17`). It also writes `default_rate` as a dollars float (`:113`) while the live UI writes cents. | Retarget to `ServiceCatalogManager.tsx` (save at `:330-333`) and `QuickAddService.tsx`. Delete `ServiceForm.tsx`. |
| 5 | A catalog price change reaches lines with no stored rate | Only partly. The fixed path reads **`service_catalog.default_rate`** (`billingEngine.ts:3575`, `:3720`) and **never joins `service_prices`** — while hourly/usage/product paths *do* (`:4951`, `:5395`, `:5456`, `:6057`). `default_rate` is the column the codebase itself calls "legacy" and "currency-untagged" (`contractWizardActions.ts:1071-1073`), and `ServiceCatalogManager` only mirrors it into `default_rate` via an `onBlur` side-effect on price row 0 (`:932-941`). | For any non-USD tenant the feature would be a lie, and for USD it would be unreliable. Fixing this is a prerequisite, not scope creep. See Piece 0. |

**The defect in the brief (#5 of its list) is confirmed and is the blocker**, at three clone sites, not one:
`contractLineRepository.ts:302-305` → insert `:339`; the near-identical fork
`server/src/lib/repositories/contractLineRepository.ts:299-302` → `:336`; and
`templateClone.ts:76,84`, which uses *different* precedence (no `base_rate` fallback).

**Additional defects found, all in the blast radius of this work** (each gets a fix + test below):

- `updateContractLine` **nulls `custom_rate` when the field is merely absent** from a partial update
  (`contractLineRepository.ts:558-560`, `:611`). A partial edit silently destroys a negotiated rate.
- `createPricingSchedule`'s overlap check compares `end_date > effective_date` instead of against the
  new `endDate` (`contractPricingScheduleActions.ts:198-206`, same at `:284-310`), and the DB has no
  exclusion constraint to backstop it.
- The deferred-revenue reader and the engine **disagree on null-rate schedules**: the reader excludes
  null-rate rows *before* picking the latest (`loaders.ts:315`), the engine picks the latest *then*
  checks null (`billingEngine.ts:4133-4137`). The reader's doc comment claims it "mirrors the billing
  engine's override lookup" (`loaders.ts:266-271`); it does not.
- The engine's unit-revision map is keyed on `service_id` alone (`billingEngine.ts:4212`) while the
  stored key is `(service_id, config_id)`; a line with two configs of one service drops a revision.
  `contractMonthlyValue.ts:199` keys it correctly — so valuation and invoicing disagree.
- `cloneTemplateLineToContract` writes **no** `contract_line_service_fixed_config` row, while
  `contractWizardActions.ts:1239-1255` snapshots the catalog rate *into* `clsfc.base_rate`. Two
  creation paths, two different shadowing behaviours.

---

## 1. The shape of the fix, in one paragraph

A catalog price change reaches a contract line **by the line not having a stored rate** — not by
writing anything per contract. So the work is: (a) make "no stored rate" an expressible, *labelled*
state instead of an accident; (b) stop the instantiation paths from writing a rate nobody chose;
(c) make the catalog price itself effective-dated so "raise it on Nov 1" is one row at the catalog;
(d) collapse the four-and-a-half divergent rate-resolution implementations into one resolver so
billing, the deferred-revenue report, the simulator, and the rollout preview cannot disagree. The
blast radius of a price change is then **one catalog write**, and N contracts × 0 rows.

---

## Piece 0 — one resolver, one catalog price (prerequisite layer)

This is the layering fix that the rest rests on. Today the same decision is implemented five times
and they disagree in at least four observable ways (null-schedule handling, `Math.ceil` vs
`Math.round`, quantity fallback, `config_id` keying).

### 0.1 Extract `resolveFixedLineRate`

New module `packages/billing/src/lib/billing/pricing/resolveFixedLineRate.ts`.

```ts
export type RateSource =
  | 'pricing_schedule' | 'line_override' | 'unit_revision'
  | 'service_override' | 'config_override' | 'catalog' | 'catalog_legacy';

export interface ResolvedRate {
  rateCents: number | null;
  source: RateSource | null;
  sourceId: string | null;       // schedule_id / revision_id / config_id / price_id
  provenance: RateProvenance;    // see Piece 1
}

export function resolveFixedLineRate(input: {
  line: ContractLineRow;
  planServices: PlanServiceRow[];
  schedules: PricingScheduleRow[];
  revisions: UnitPricingRevisionRow[];
  catalogPrices: ServicePriceRow[];
  period: { start: string; end: string };   // [start, end)
  currency: string;
}): { line: ResolvedRate; perService: Map<string, ResolvedRate> };
```

Pure function over already-loaded rows — no DB access — so the preview, the report, the simulator and
the engine can all call it with rows loaded however suits them, and so it is unit-testable without a
database. A thin `loadFixedLineRateInputs(trx, tenant, …)` companion does the loading for callers that
don't already have the rows.

**Line-level chain** (first non-null wins):

1. Active `contract_pricing_schedules` row — scoped `contract_line_id = line.contract_line_id OR contract_line_id IS NULL`, `[effective_date, end_date)` overlapping the period, latest `effective_date`, **then** `custom_rate IS NOT NULL`. (Engine semantics, `billingEngine.ts:4133-4137`, preserved deliberately — see 2.3.) → `pricing_schedule`
2. `contract_lines.custom_rate` **when `rate_provenance IN ('custom','unreviewed')`** → `line_override`
3. otherwise (`rate_provenance = 'inherited'`, rate is NULL): derive as `Σ (memberRate × quantity)` over plan services → `derived`

**Member-level chain** (first non-null wins):

1. `contract_line_unit_pricing_revisions` latest `effective_period_start <= period.start`, keyed on
   **`(service_id, config_id)`** — fixes `billingEngine.ts:4212` → `unit_revision`
2. `contract_line_service_fixed_config.base_rate` when its `rate_provenance IN ('custom','unreviewed')` → `service_override`
3. `contract_line_service_configuration.custom_rate` → `config_override`
4. `service_prices` row for `(service_id, currency)` effective at `period.start` → `catalog`
5. `service_catalog.default_rate`, **only** when currency is the tenant default and no `service_prices`
   row exists → `catalog_legacy` (transitional; emits a one-line warn so the residue is measurable)

**Behaviour-preservation claim, which is the safety property of this whole card:** after the Piece 1
backfill every existing row is `custom` or `unreviewed` at both levels, so steps 2 and member-step 2
fire exactly where the current code fires, and the resolver returns byte-identical numbers on today's
data. This is asserted directly by test T15.

### 0.2 Make the catalog price effective-dated

There is currently no effective-dated *catalog* price anywhere — `service_prices` holds one rate per
`(service, currency)`. This is the missing bottom layer, and adding it is what removes the need to
write a schedule row per affected contract.

Migration `server/migrations/<ts>_service_prices_effective_dating.cjs`:

- add `effective_date date NOT NULL DEFAULT '1970-01-01'`
- drop unique `(tenant, service_id, currency_code)`; add unique `(tenant, service_id, currency_code, effective_date)`
- add index `(tenant, service_id, currency_code, effective_date DESC)`
- `exports.config = { transaction: false }`, guarded by `hasColumn`, matching house style

Existing rows keep `1970-01-01`, so "the row" and "the row effective now" are the same row and every
current reader's answer is unchanged.

### 0.3 Join the effective catalog price, including on the fixed path

Add a shared join helper `packages/billing/src/lib/billing/pricing/joinEffectiveServicePrice.ts`
(`DISTINCT ON`-style lateral: latest `effective_date <= asOf` for the contract currency), and apply it at
**six** sites:

- **New** — fixed path: `billingEngine.ts:3557-3562` and `:3703-3707`; select `sp.rate as currency_rate`
  alongside the existing `sc.default_rate` (`:3575`, `:3720`).
- **Migrate** — existing equality joins that currently assume one row per currency: `:4951`, `:5395`,
  `:5456`, `:6057`.

Then `computeFixedCharges` prefers `currency_rate ?? default_rate` at each of its five `default_rate`
reads (`:211`, `:466`, `:692`, `:714`, `:897`).

### 0.4 Fix the operator-facing price write

`ServiceCatalogManager.tsx:330-333` performs two non-atomic actions and mirrors `default_rate` only via
an `onBlur` on price row 0 (`:932-941`), so saving while the field still has focus silently diverges the
two stores. Replace with a single transactional action `updateServicePricing(serviceId, patch, prices)`
that writes `service_catalog.default_rate` from the primary price row and the `service_prices` rows
together, and derives `default_rate` at save time, not on blur.

Delete `packages/billing/src/components/billing-dashboard/ServiceForm.tsx` and update the two static
guard tests that reference it.

### 0.5 Retire the divergent copies

- `packages/reporting/.../deferred-revenue/loaders.ts:272-324` — delete `loadPricingScheduleRates` /
  `resolvePricingScheduleRate`, call the resolver. This is what makes test T7 true by construction
  rather than by coincidence.
- `ee/server/src/lib/billing/simulator/loadSimulationCalculationInput.ts:825-880` — call the resolver.
- `shared/billingClients/contractMonthlyValue.ts:232-244` — call the resolver; this fixes the
  `Math.round` vs `Math.ceil` and quantity-fallback drift its own comment at `:80-83` warns about.
- `server/src/lib/repositories/contractLineRepository.ts` — re-export from
  `packages/billing/src/repositories/contractLineRepository.ts` rather than remaining a 687-line fork.
  Three divergent copies of the rate decision is how this bug got in; leaving them is leaving the trap armed.

---

## Piece 1 — rate provenance

### 1.1 Storage shape: a three-valued enum, at both rate levels

A nullable rate plus a boolean cannot express the state that actually dominates the data: *"there is a
number here and nobody knows who put it there."* That state is the whole problem, so it gets a name.

```
rate_provenance  ∈  'custom' | 'inherited' | 'unreviewed'
```

on **both** rate-bearing tables, because both shadow the catalog:

- `contract_lines.rate_provenance` (governs `custom_rate`)
- `contract_line_service_fixed_config.rate_provenance` (governs `base_rate`)

Per-member scoping is not optional: `contractWizardActions.ts:1239-1255` snapshots the catalog rate
into `clsfc.base_rate` at creation, so a wizard-built line would keep shadowing the catalog even with a
perfect line-level fix.

**Invariants, as DB CHECK constraints:**

| provenance | rate column | meaning |
|---|---|---|
| `inherited` | **must be NULL** | follows the catalog, forever |
| `custom` | **must be NOT NULL** | a human chose this; catalog changes never touch it |
| `unreviewed` | **must be NOT NULL** | legacy row; bills exactly as today; not yet classified |

The `custom ⇒ NOT NULL` constraint is what forces the `updateContractLine` partial-update bug
(`contractLineRepository.ts:558-560`) to be fixed rather than papered over: the fix is to omit the key
when absent instead of coercing to `null`.

### 1.2 Billing semantics

`custom` and `unreviewed` are **billing-identical** — both take the stored number at chain step 2.
`inherited` is expressed as NULL, which is exactly the fall-through the engine already implements and
already has passing tests for (`contractQuantityUsageSemantics.test.ts:564-586`).

So **Piece 1 changes the engine's precedence logic not at all.** It changes what gets *written*, and
adds a label. That is the entire risk surface, and it is why legacy rows are safe by construction.

### 1.3 Stop writing rates nobody chose

All three clone sites get the same rule, expressed once in a shared helper
`resolveClonedRate({ explicitRate, templateRate, templateProvenance, templateBaseRate })`:

| input | result |
|---|---|
| caller passed an explicit `customRate` | `{ rate, 'custom' }` |
| template line is `custom` | `{ templateRate, 'custom' }` — clone-time snapshot, per existing doctrine |
| template line is `inherited` | `{ null, 'inherited' }` |
| template line is `unreviewed` | `{ templateRate, 'unreviewed' }` — propagates the unknown honestly |

Sites: `contractLineRepository.ts:302-305/339`, the `server/` fork `:299-302/336` (which 0.5 deletes),
`templateClone.ts:76/84`, and `cloneFixedConfig` at `templateClone.ts:255-267` for the member level.
The wizard (`contractWizardActions.ts:1239-1255`) writes `{ null, 'inherited' }` instead of snapshotting
the catalog rate, unless the operator typed a rate.

**This answers the open question "what happens when a template's price changes?"** — nothing changes.
Template edits remain provenance-only for live lines, exactly as the doctrine comment at
`contractLineRepository.ts:315-317` requires. A template rate is a *snapshot source at clone time*; the
catalog is a *live authority* for `inherited` lines. They are different authorities and the doctrine is
preserved rather than carved out.

### 1.4 The hard question: classifying rows that already exist

**Backfill (mechanical, zero billing change):** every row with a non-null rate → `unreviewed`; every
row with a null rate → `inherited`. Because `unreviewed` bills identically to today, the migration
moves zero dollars. This is asserted by test T16, which runs a full invoice before and after the
migration and requires byte-identical output.

That is the safe default the brief asks for — and it is neither of the two unacceptable options. But a
safe default that nobody can act on is just a stalled feature, so:

**The assisted reclassification pass ("Rate review").** For each `unreviewed` row, compute what the
resolver would return *if the stored rate were NULL*, for the current period, and compare:

- **Exact match** → propose `inherited`. This is the high-confidence case, and applying it is a
  **provable no-op on the next invoice**: the resolver returns the identical number by definition of the
  match. The apply transaction re-runs the comparison under `lockTenantBilling` and **refuses the row**
  if it has drifted since the preview (test T9).
- **Differs** → propose `custom`. Applying is a pure relabel: the rate column is not touched, and the
  invoice cannot move.

The operator is therefore asked exactly one question, and it is an answerable one: *"these N lines are
priced at exactly the catalog price today — should they keep following it?"* Not the unanswerable
*"was this negotiated three years ago?"*

**Skip rules** — rows that stay `unreviewed` and say why:
- contract currency has no `service_prices` row for the service (the `default_rate` comparison would be
  currency-meaningless — see correction #5)
- the line's members resolve to no catalog rate at all
- the contract is inactive or ended

**Going forward the `unreviewed` population is closed and shrinks monotonically**, because every write
path after 1.3 sets an explicit provenance. `unreviewed` is a migration artefact with a known end state,
not a permanent third mode. A `grep`-able counter query ships in the rollout dialog so operators can
see it trend to zero.

**If the operator never runs the pass:** billing is unchanged forever, and the rollout dialog shows the
unreviewed lines in their own bucket with a link to the review. Visible, safe, actionable.

### 1.5 Migrations

1. `<ts>_add_rate_provenance_to_contract_lines.cjs` — column, CHECK, backfill, index
   `(tenant, rate_provenance)`.
2. `<ts>_add_rate_provenance_to_service_fixed_config.cjs` — same for
   `contract_line_service_fixed_config`.
3. `<ts>_add_contract_line_services_service_index.cjs` — index `(tenant, service_id)` on
   `contract_line_services`. Verified absent today; "which lines use this service" is the hot path for
   both the "used on N contracts" badge and the preview.

House style: `hasColumn`/`hasConstraint` guards, `exports.config = { transaction: false }`, matching
`20260904100000_contract_quantity_usage_semantics.cjs`. Register both columns' tables in
`packages/db/src/lib/tenantTableMetadata.ts` if not already present (both are).

---

## Piece 2 — pricing schedules: the verdict

**Salvageable, but demoted. It is not the foundation for catalog price changes, and routing them
through it would be the wrong design.**

### 2.1 Why it is not the foundation

- **Wrong scope.** It is keyed on `contract_id` (`20251012000000:21,44`). One row changes *every line on
  the contract*. A per-service M365 price rise has entirely the wrong blast radius.
- **Wrong slot.** Its value overrides the line-level `effectiveCustomRate` (`billingEngine.ts:4138`),
  which for a bundle line is the *whole-bundle total*, not a per-service rate.
- **Cannot express the thing we need.** It has no way to say "revert to catalog": a NULL `custom_rate`
  is inert (the engine skips it at `:4133-4137`), and the fall-through target is the assignment rate,
  not the catalog.
- **It would reintroduce the blast radius we are trying to eliminate.** A row per affected contract
  means a price change writes N rows that immediately become N new stale snapshots — the exact disease.

### 2.2 What it is genuinely for, and what it gets

Its real job is **contract-level negotiated rate overrides across time** ("this client gets $X from
Jan–Jun"). That is a legitimate, distinct job and the table does it adequately. It gets:

- **Line scoping**: add nullable `contract_line_id` (NULL preserves existing rows' contract-wide
  meaning exactly, so no data migration). Resolver step 1 already reads
  `contract_line_id = <line> OR contract_line_id IS NULL`, most-specific-then-latest.
- **The overlap bug fixed** (`contractPricingScheduleActions.ts:198-206`, `:284-310`), plus a DB-level
  `EXCLUDE USING gist` constraint on `(tenant, contract_id, contract_line_id, daterange(effective_date, end_date))`
  so the app-layer check has a backstop.
- **`getActivePricingScheduleByContract` deleted** — exported, zero call sites repo-wide.
- **Its resolution unified** with the engine via Piece 0's resolver, which is what fixes the
  deferred-revenue divergence.

### 2.3 One deliberate non-change

The engine's "latest schedule wins, *then* check null" ordering means a null-rate latest schedule
**blocks** older schedules rather than falling back to them. The EE simulator documents this
deliberately (`loadSimulationCalculationInput.ts:825-827`). We **keep engine semantics** and change the
report to match, not the reverse — the engine is what actually bills, and changing it would move money
on contracts that have null-rate schedules today. Called out here so the divergence is closed knowingly
in one direction rather than silently in whichever direction the implementer happens to pick.

### 2.4 What is *not* added

No new per-contract row is written by a catalog price change. Effective-dating of a catalog price lives
at the catalog (Piece 0.2), which is one row for all N contracts. `contract_line_unit_pricing_revisions`
keeps its job (prospective seat/quantity changes at validated service-period boundaries) and is **not**
merged into pricing schedules — it is the better-built of the two (boundary validation, billed-period
protection, per-member scope) and merging them is a separate card. It does get the `config_id` keying
bug fixed (`billingEngine.ts:4212`) and a read of the resolver.

---

## Piece 3 — the rollout UI

All components from `@alga-psa/ui/components/*`. All money through `useCurrencyFormat().money(minorUnits)`
with the currency taken from the price row / contract, never a literal. All interactive elements get
kebab-case `id`s per `docs/AI_coding_standards.md:926-982`. Dialog action buttons go in the `footer`
prop with `type="button"` + `form.requestSubmit()` per `:145-173`.

### 3.1 Entry point A — saving a new price

`ServiceCatalogManager.tsx` edit dialog (`:748-1135`), save at `:330-333`. On save, if the effective rate
changed **and** the service is on ≥1 contract line, open `PriceChangeRolloutDialog`.

`id="price-change-rollout-dialog"`. Contents:

- **Header**: old → new, `money()`, with the currency code shown explicitly.
- **Effective date**: `DatePicker id="price-change-effective-date"`, defaulting to the **next billing
  period boundary**, not today. Writes the `service_prices.effective_date` from Piece 0.2.
- **Four buckets**, each a count + expandable section:
  1. **Will change** — `inherited` lines. `DataTable id="price-change-affected-grid"` with a hand-rolled
     `Checkbox` selection column (`DataTable` has **no** selection API — verified; precedent
     `DraftsTab.tsx:585`) and a `BulkActionBar` for select-all/none. Columns: client, contract, line,
     current rate, new rate, delta.
  2. **Won't change — custom** — read-only list with each line's rate and the client it belongs to.
  3. **Won't change — not yet classified** — the `unreviewed` bucket, with an inline
     `Alert variant="info"` explaining that these bill unchanged and a "Review rates" link to 3.3.
  4. **Excluded — already invoiced for this period** — with the reason per row. Computed by the shared
     `isPeriodAlreadyInvoiced` helper that wraps the engine's existing checks
     (`hasExistingInvoiceForCycle` `:1051-1079`, `recurring_service_periods.invoice_id`
     `:6699-6738`), so the dialog and the engine cannot disagree about what is already billed.
- **Total monthly revenue delta**, `moneySigned()`, computed by the resolver over bucket 1 only.
- **Footer**: `id="price-change-apply"` (primary) and `id="price-change-skip"` — **"Just save the price"
  is a first-class, always-available option**, mirroring `QboItemImportStep`'s stated contract
  ("Skippable — the wizard's Next button is always available", `:23-28`).

Structural model copied from `QboItemImportStep.tsx`: a preview that writes nothing and says so, an
execute button that lives inside the preview panel and shares the *same* options closure so preview and
execute cannot drift, and three mutually-exclusive `Alert`s for preview-error / apply-error / result.

### 3.2 Entry point B — "used on N contracts"

A badge/button on the service row in `ServiceCatalogManager`'s DataTable
(`id="service-contract-usage-{n}"` — note rule 4, no entity ids in the `id`; the service id goes in
`data-service-id`). Opens the same dialog with no pending price change, so it doubles as "who is on
this price?". Count comes from a cheap indexed aggregate over `contract_line_services` grouped by
provenance — this is the *only* synchronous query.

### 3.3 Contract-line surfaces

- **Badge** in the line meta strip at `ContractLines.tsx:1160-1167` (`Badge` already imported at `:38`):
  `Standard` (`variant="default-muted"`) / `Custom` (`variant="info"`) / `Unreviewed`
  (`variant="warning"`). While there, fix the hardcoded `text-blue-600` at `:1162` — no `dark:` variant,
  violates `docs/AI_coding_standards.md:48`.
- **Per-service badge** in `GenericContractLineServicesList.tsx`'s `render` at `:352-359`, which already
  computes the standard-vs-custom fall-through and simply doesn't surface it.
- **"Reset to standard"** — row action, `id="reset-line-rate-to-standard"`. Sets rate NULL +
  `inherited` in one transaction, with a confirmation showing current → new rate. **In round one**: it
  shares the apply path, the resolver and the transaction with 1.4's reclassification, so it is nearly
  free, and without it an operator has no way to correct a line wrongly marked `custom`.
- **Rate review screen** — the bulk surface for 1.4, grouped by service, showing proposed
  classification, confidence and the "no change to your next invoice" guarantee for the exact-match set.

### 3.4 Answering the open question on preview cost

**Split, not synchronous.** The bare count (3.2) is one indexed aggregate and runs inline. The full
preview — per-line resolved rates, deltas, invoiced-period exclusion — is a separate server action
`previewServicePriceChange(serviceId, newRate, effectiveDate)`, exactly like
`previewQboItemImport`. It touches every contract line carrying the service and runs the resolver per
line per period; that is not save-path work.

---

## Piece 4 — CI integration tests

### 4.1 Placement, and the trap

- **Integration** → `server/src/test/integration/billing/`. This is a **whole-directory entry** in
  `tier1.manifest.json`, so new files there join tier1 automatically. Prefer this for action-level and
  classification tests.
- **Infrastructure** → `server/src/test/infrastructure/billing/catalogPricing/`. **Trap:** per-PR runs
  use `INFRA_MODE=tier1`, which runs **only** the five frozen files in
  `scripts/lib/infrastructure-selection.mjs:1-8`. A new infra test gates PRs **only if added to that
  array** *and* to `server/package.json:38` (whose list already disagrees with the floor — it has 4
  entries to the floor's 5; reconcile while there). Without this the tests run only nightly and the card's
  "lands in CI as part of THIS card" requirement is not met.
- Note `scripts/lib/integration-selection.mjs:8` puts `server/test-utils/` in `outsideGraph`, so touching
  `billingTestHelpers.ts` forces the full integration + infrastructure lanes on this PR. Expect a long CI
  run; do not "fix" it by avoiding the helper.

### 4.2 Fixtures

Existing helpers cover almost everything: `createTestService` (`billingTestHelpers.ts:506`, seeds both
`service_catalog` and `service_prices`), `createFixedPlanAssignment` (`:604`), `addServiceToFixedPlan`
(`:1435`), `materializeRecurringServicePeriods` (`:1076`), `unwrapInvoiceResult` (`:1096`),
`createPricingSchedule` (`pricingScheduleHelpers.ts:83`). Closest model to copy wholesale:
`pricingScheduleRateOverrides.test.ts`.

New helpers needed:
- `setLineProvenance(context, contractLineId, provenance, rateCents?)`
- `updateCatalogPrice(context, serviceId, { rateCents, currency, effectiveDate })`
- **`seedServicePrice` must be exercised with `false`** in at least one test, so the fixture stops
  masking the `default_rate`-vs-`service_prices` divergence (correction #5) by seeding both stores from
  one value (`billingTestHelpers.ts:583-595`).

### 4.3 Test list

**Core six from the card:**

| id | assertion |
|---|---|
| T1 | `inherited` line follows a catalog price change: invoice for the next period reflects the new rate |
| T2 | `custom` line does **not** follow it; invoice is unchanged |
| T3 | effective date honoured — a change effective mid-period does not alter the current period's invoice, and does alter the next |
| T4 | a period whose invoice is already generated is untouched, and `previewServicePriceChange` reports it as excluded with a reason |
| T5 | reset-to-standard re-links: line bills the catalog rate on the next period |
| T6 | the deferred-revenue report and the generated invoice agree for the same line/period, across all three provenance values and with a pricing schedule active |

**Provenance and the backfill — the crux:**

| id | assertion |
|---|---|
| T7 | `unreviewed` line does **not** follow a catalog change (the legacy-safety property) |
| T8 | reclassifying an exact-match line to `inherited` produces a byte-identical invoice for the next period |
| T9 | reclassify-apply **refuses** a row whose catalog rate drifted between preview and apply, and says so |
| T10 | a line whose contract currency has no `service_prices` row is skipped by the pass and stays `unreviewed`, with a reason |
| T11 | template clone: `inherited` template line → live line with NULL rate and `inherited`; a later catalog change reaches it |
| T12 | template clone: `custom` template line → `custom` live line; a later **template** price edit does **not** move it (doctrine `contractLineRepository.ts:315-317`) |
| T13 | wizard-created line is `inherited` and follows the catalog (no `clsfc` snapshot) |
| T14 | CHECK constraints reject `inherited` + non-null rate, and `custom` + null rate |
| T15 | **resolver equivalence**: for a matrix of line shapes (bundle, unit-priced, schedule-active, revision-active, no-members), `resolveFixedLineRate` returns exactly what the pre-change engine returned. Golden-file style, against the fixtures already in `server/src/test/integration/billing/goldenOutput/` |
| T16 | **migration is money-neutral**: generate an invoice, run the provenance migrations, regenerate, assert identical totals and line amounts |

**Defects found in the audit — each gets a regression test:**

| id | assertion |
|---|---|
| T17 | partial `updateContractLine` that omits `custom_rate` leaves the rate intact (`:558-560`) |
| T18 | overlapping pricing schedules are rejected by both the action and the DB constraint, including the case the current check misses |
| T19 | a line with two configs of the same service applies **both** unit revisions (`billingEngine.ts:4212`) |
| T20 | fixed path prices from `service_prices` in the contract's currency, not `default_rate`; a non-USD contract bills the non-USD rate (uses `seedServicePrice: false`) |
| T21 | null-rate latest pricing schedule blocks older schedules identically in billing **and** the deferred-revenue report (2.3) |

---

## Sequencing

Each step is independently landable and leaves the tree green.

1. **Piece 0.1–0.2** — resolver + effective-dated `service_prices`, behind no flag; T15/T16 prove
   equivalence. Nothing observable changes.
2. **Piece 0.3–0.5** — six join sites, fixed-path currency fix, delete the divergent copies, delete
   `ServiceForm.tsx`. T20/T21 land here.
3. **Piece 1** — migrations, CHECKs, backfill to `unreviewed`, clone-path fix. T7/T11–T14/T16–T17.
4. **Piece 2** — line scoping, overlap fix + EXCLUDE constraint, dead action removal. T18/T21.
5. **Piece 3.3** — badges + reset-to-standard + rate review screen. T5/T8–T10.
6. **Piece 3.1–3.2** — the rollout dialog and preview action. T1–T4/T6.
7. Update `docs/billing/billing.md:185` (stale precedence chain) and the `loaders.ts:266-271` comment.

Steps 1–2 are the load-bearing ones and carry the equivalence proof; if the plan is wrong anywhere, T15
fails there and cheaply.

---

## Explicitly out of scope

Xero → Alga price import. Pushing prices to Xero's Item catalog. Ongoing catalog CDC. Hourly/usage rate
*provenance* (their catalog reads change only via the shared resolver). Merging
`contract_line_unit_pricing_revisions` into `contract_pricing_schedules`. Redesigning the contract line
editor.

## Follow-up cards this surfaces

1. **Hourly/usage rate provenance** — the deferred half; the resolver already has the shape.
2. **Merge the two effective-dating mechanisms** — `contract_pricing_schedules` and
   `contract_line_unit_pricing_revisions` do overlapping jobs with different scope keys, date semantics
   and safety guarantees. Revisions has the better safety model, schedules has the better UI. One should
   absorb the other.
3. **Retire `service_catalog.default_rate`** — this card reduces it to a transitional fallback with a
   warn; a follow-up can measure the residue and drop the column.
4. **A unit-pricing-revision list/history UI** — none exists; revisions are invisible after scheduling.

## Answers to the card's open questions

| question | answer |
|---|---|
| Price change → schedule row per contract, or catalog-level resolution? | **Catalog-level, resolved at billing time.** One effective-dated `service_prices` row for all N contracts; zero per-contract rows. Per-contract rows would manufacture N fresh stale snapshots. |
| What happens when a template's price changes? | **Nothing changes.** Template edits stay provenance-only for live lines. A template rate is a clone-time snapshot source; the catalog is a live authority for `inherited` lines. No carve-out needed. |
| Is "reset to standard" in round one? | **Yes.** It shares the resolver, transaction and apply path with reclassification, and without it a wrongly-`custom` line is uncorrectable. |
| Does the affected count need a preview action? | **Split.** The bare count is one indexed aggregate, inline. The full preview with deltas and invoiced-period exclusion is a separate action, modelled on `previewQboItemImport`. |
| Is `contract_pricing_schedules` salvageable? | **Yes, but demoted** — it keeps contract-level negotiated overrides, gains line scoping, loses the overlap bug. It is *not* the mechanism for catalog price changes. |

---

## Implementation notes (appended after the approved body)

These notes record what the implementation round actually landed and the
decisions it had to make. They do not modify the body above.

### Reconciliation against the branch

All seven pieces are landed. The load-bearing surface:

| Piece | Status | Where it lives |
|---|---|---|
| 0.1 resolver | landed | `packages/billing/src/lib/billing/pricing/resolveFixedLineRate.ts` + `loadFixedLineRateInputs.ts` |
| 0.2 effective-dated catalog price | landed | `server/migrations/20260912100000_service_prices_effective_dating.cjs` |
| 0.3 effective price join incl. fixed path | landed | `joinEffectiveServicePrice.ts`; engine sites 3594/3750/5021/5457/5511/6105; T20 |
| 0.4 atomic price write; `ServiceForm.tsx` deleted | landed | `packages/billing/src/actions/serviceActions.ts` (`updateServicePricing`); static guard in `onboardingServiceTypeDecoupling.static.test.ts` |
| 0.5 retire divergent copies | partial by design | the 687-line `server/` repository fork now re-exports the package repo; the deferred-revenue loader and EE simulator share `selectActivePricingSchedule` / `selectEffectiveServicePrice`; `contractMonthlyValue.ts` still re-derives the chain (its own `LEVERAGE` note). See the verdict below. |
| 1 provenance + backfill + check constraints | landed | `20260912110000`, `20260912120000`, `20260912130000`; `rateReviewActions.ts`; `classifyLineRateProvenance.ts` |
| 2 schedules line-scoped, overlap fixed, EXCLUDE backstop | landed | `20260912140000`; `contractPricingScheduleActions.ts` |
| 3 rollout dialog, usage badge, line surfaces, rate review | landed | `servicePriceRolloutActions.ts`; `PriceChangeRolloutDialog.tsx`; `RateReviewDialog.tsx`; `ServiceCatalogManager.tsx`; `ContractLines.tsx`; `GenericContractLineServicesList.tsx` |

Tests T1–T7, T16, T19, T20, T21 run in the tier-1 infrastructure floor
(`scripts/lib/infrastructure-selection.mjs`). T8–T14, T17, T18, T22 run in
`server/src/test/integration/billing` (tier-1 integration). T15 remains the
hand-authored precedence matrix in `resolveFixedLineRate.test.ts`, whose own
header disclaims engine parity; the DB-backed preview-vs-invoice parity test
below now supplies the engine-equivalence evidence T15 named as a gap.

### Resolver-drift verdict (open item 3c)

**The billing engine keeps its inline resolution chain in round one, guarded by
the DB-backed preview-vs-invoice parity test. Collapsing the engine onto
`resolveFixedLineRate` is a recorded follow-up, not part of this card.**

Rationale. The parity test
(`catalogPriceResolution.test.ts`, "the rate the rollout preview shows equals
the rate the engine bills") prices the same line through both implementations —
the preview through the resolver, the invoice through the engine — across five
fixed-path shapes: inherited, custom, unreviewed, active pricing schedule, and a
unit-priced member. They agree today. That is the safety property the deviation
needs, and it is now CI-selected rather than asserted by reading code.

Collapsing the engine now would risk moving money for reasons outside this
card's subject: the engine's fixed-charge path also carries FMV allocation,
`Math.ceil` unit-seat arithmetic, the `client_contract_line` custom-rate alias,
and a fallback to `service_catalog.default_rate` when a non-default-currency
contract has no `service_prices` row — behaviours the pure resolver either does
not model or models differently. Those differences are precisely what a
follow-up should reconcile deliberately, with its own before/after invoice
evidence, rather than fold into a catalog-price-change round.

Blast radius of keeping the chain. The parity test guards fixed/recurring lines
on the five shapes above. It does **not** guard: hourly/usage paths (out of
scope per the plan), the non-default-currency missing-`service_prices` fallback
divergence, unit revisions applied when a member is not `pricing_basis='unit'`,
or `contractMonthlyValue.ts` (which re-derives and is named in Piece 0.5). Each
is a known, bounded gap, not a silent one.

### Open items from the work order

- **3a** — `docs/billing/billing.md` now states which callers use the full
  resolver (rollout preview, rate review, `classifyLineRateProvenance`) versus
  the shared selection helpers (deferred-revenue report, EE simulator), and
  records that the engine keeps an equivalent inline chain and that
  `contractMonthlyValue.ts` does not use the resolver.
- **3b** — the DB-backed preview-vs-invoice parity test lives in the tier-1
  infrastructure floor and is selected by `INFRA_MODE=tier1` (confirmed by
  running `scripts/run-infrastructure-tests.mjs`).
- **3c** — verdict recorded above.
- **3d** — the six-case `automatic submission refuses stale …` matrix in
  `contractQuantityUsageSemantics.test.ts` carries a per-test 120 s timeout
  (test-only); the suite's global `testTimeout` is unchanged.
