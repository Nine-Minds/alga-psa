# Fixed-line member `base_rate`: one stored meaning, one interpreter

Card c150b8de (follow-up to alga-2026-0002499 / PR #3558, review observation C2).
Branch `fix/fixed-line-base-rate-has-two-meanings-inherited`, base `main` @ d6dc22c273.

## 1. The defect, grounded in code

`contract_line_service_fixed_config.base_rate` (minor units, one row per fixed
member configuration) is written with two different meanings, and nothing on the
row records which one it has.

| Meaning | Member's contribution to the line fee | Written by |
|---|---|---|
| **Share**: this member's slice of the bundle fee | `base_rate` | Contract wizard, `writeFixedLineMembers` (`packages/billing/src/actions/contractWizardActions.ts:160-240`): `allocateBundleBaseRate` splits the line total across bundle members by quantity, and each share is stored with `rate_provenance='custom'`. |
| **Per-unit**: a unit price for the member | `base_rate × quantity` | The same wizard function when no bundle total is given and a fixed-mode default exists (`:215-225`); every `pricing_basis='unit'` seat; and other writers (see §3). |

The readers each assume a single meaning:

| Reader | Reading | Location |
|---|---|---|
| `resolveFixedLineRate`, inherited-line derivation | per-unit (`rate × quantityOf`) | `shared/billingClients/resolveFixedLineRate.ts:531-539` |
| `resolveFixedPlanLevelBaseRate`, which is how the **invoice engine** actually derives the fee of a line with no line rate | per-unit (`service_base_rate × qty`) | `packages/billing/src/lib/billing/compute/computeFixedCharges.ts:253-279` |
| `allocateFixedFeeWithoutCatalogPrice`, the zero-FMV split | share (weight = `base_rate`, "never × quantity") | `computeFixedCharges.ts:470-500` |
| `contractMonthlyValue`, bundle `deriveFrom` | per-unit | `shared/billingClients/contractMonthlyValue.ts:410-426` |
| Deferred-revenue `loadFixedConfigBaseRates` | per-unit | `packages/reporting/src/actions/report-actions/deferred-revenue/loaders.ts:409-442` |
| `computeFixedCharges`, non-Fixed-line edge path | per-unit | `computeFixedCharges.ts:1216-1226` |
| EE simulator | passes `service_base_rate` into the same compute code | `ee/server/src/lib/billing/simulator/loadSimulationCalculationInput.ts:929` |
| Rate review / reclassification and rollout preview | via `resolveFixedLineRate` | `rateReviewActions.ts`, `classifyLineRateProvenance.ts`, `servicePriceRolloutActions.ts` |

The card names two readers. The invoice engine does not call
`resolveFixedLineRate` for the line fee; it calls `resolveFixedPlanLevelBaseRate`,
which repeats the per-unit derivation. That makes it a third reader with the same
defect, and `contractMonthlyValue` and the deferred-revenue report are a fourth
and fifth.

How each symptom arises:

1. **Wrong split.** An inherited line (`contract_lines.custom_rate` NULL) has
   per-unit members ADDON 225×1 and BLKHR 225×3, and catalog prices are zero. The
   engine derives the fee as 225 + 675 = 900, which is correct. The zero-FMV
   fallback then weights by raw `base_rate` (225 : 225) and bills 450/450 instead
   of 225/675.
2. **Wrong total.** The wizard writes the line total to `contract_lines.custom_rate`
   (through `ContractLineFixedConfig.upsert`, `models/contractLineFixedConfig.ts`)
   and quantity-proportional shares to the members (225 for qty 1, 675 for qty 3).
   Clearing the line rate in the fixed-config editor (`update` with
   `base_rate: null` sets `custom_rate=NULL, rate_provenance='inherited'`) leaves
   the shares in place. Both the resolver and the engine then read them per-unit:
   225×1 + 675×3 = 2,250 instead of 900.
   `resetContractLineRateToStandard` does not produce this state, because it also
   clears the bundle members' `base_rate` (`rateReviewActions.ts:443-456`).

Why this matters: tax is computed per allocated member (`computeFixedCharges.ts:1035-1063`),
so a wrong split gives wrong tax whenever members differ in taxability or region.
Even when they don't, it gives wrong per-service invoice lines, revenue
attribution and GL mapping. A wrong total is a wrong invoice.

## 2. Decision: store the meaning, and interpret it in one place

### 2.1 Storage: a new `base_rate_basis` column, separate from `pricing_basis`

Add `contract_line_service_fixed_config.base_rate_basis text`, with values
`'per_unit' | 'share'`.

- `pricing_basis` answers a different question: does this member bill on its own
  as a seat (`'unit'`), or is it part of the bundle fee (`'bundle'`/NULL)? Seats
  are always per-unit. Bundle members can be either: wizard members carry shares,
  while hand-edited members and fixed-mode defaults carry per-unit prices.
  Folding both answers into one enum would combine two independent questions. It
  would also make every `pricing_basis === 'unit'` predicate
  (`isUnitPricedFixedConfig`, `isUnitFixedService`, `isUnitPricedFixedService`,
  `rateReviewActions` SQL) silently treat a new third value as a bundle member.
  So the meaning gets its own column, and the database enforces how it relates to
  `pricing_basis`.
- `rate_provenance` answers who chose the number (custom, inherited or
  unreviewed), not how to scale it. It stays as it is.
- Constraints, added after the backfill in §4:
  - `CHECK (base_rate_basis IS NULL OR base_rate_basis IN ('per_unit','share'))`
  - `CHECK ((base_rate IS NULL) = (base_rate_basis IS NULL))`: a stored number
    always has a stored meaning, and a NULL rate has none.
  - `CHECK (pricing_basis IS DISTINCT FROM 'unit' OR base_rate_basis IS DISTINCT FROM 'share')`:
    seats are never shares.
- Citus: `contract_line_service_fixed_config` is tenant-distributed. Add the
  column and the CHECK constraints with plain `ALTER TABLE` in the house migration
  style (`20260912120000_add_rate_provenance_to_service_fixed_config.cjs` is the
  template, including its `hasColumn`/`hasConstraint` guards).
  `docs/AI_coding_standards.md` §CitusDB applies.

A conversion-only alternative was rejected: rewriting every share as a per-unit
price (`share / qty`) is not lossless. 1000 split over qty 3 gives a fractional
cent, and it changes what a later quantity edit means. The two meanings are both
legitimate operator intents, so the data must keep both.

### 2.2 Interpretation: one client-safe helper

Create `shared/billingClients/fixedMemberRate.ts`. It must have no DB imports, so
that `packages/billing/src/lib/fixedServiceBasis.ts` (wizard/UI) can re-export it,
just as `resolveFixedLineRate` is re-exported through
`packages/billing/src/lib/billing/pricing/resolveFixedLineRate.ts`.

```ts
export type FixedRateBasis = 'per_unit' | 'share';

/** Stored label → meaning. Seats are always per-unit. A NULL label on a
 *  non-NULL rate (pre-backfill rows, synthetic simulator rows) reads as
 *  per_unit, which is exactly how the invoice engine bills such rows today. */
export function fixedRateBasisOf(row: {
  pricing_basis?: string | null;
  base_rate_basis?: string | null;
}): FixedRateBasis;

/** The amount this member contributes to the line fee for one period:
 *  per_unit → Math.round(rateCents × quantity); share → rateCents as-is. */
export function fixedMemberContributionCents(
  rateCents: number,
  basis: FixedRateBasis,
  quantity: number,
): number;

/** Exact-sum split of a fee across weighted members (largest remainder, ties
 *  by key). This is the single weight → cents allocator. */
export function allocateCentsByWeights(
  totalCents: number,
  members: ReadonlyArray<{ key: string; weight: number }>,
): { amounts: number[]; proportions: number[] };
```

`allocateCentsByWeights` moves here unchanged from `computeFixedCharges.ts:428-452`.
§2.4 covers the LEVERAGE fold.

### 2.3 Rewire every reader through the helper

1. **`resolveFixedLineRate.ts`**
   - Add `basis: FixedRateBasis` to `ResolvedRate` (member-level; at line level
     this is the basis of `rateCents`).
   - Add `base_rate_basis?: string | null` to `PlanServiceRateRow`.
   - `resolveMemberRate`: `service_override` gets the basis from
     `fixedRateBasisOf(service)`. Every other source gets `per_unit` (unit
     revision, config override, catalog, legacy catalog). §3 covers Fixed
     configuration `custom_rate`.
   - The inherited-line derivation becomes
     `Σ fixedMemberContributionCents(member.rateCents, member.basis, quantityOf(service))`.
     The `quantityOf` helper stays.
   - Export `memberContributionCents(resolved, service)` so that callers which
     value a member never re-derive the multiplication.
2. **`computeFixedCharges.ts`**
   - Add `base_rate_basis?: string | null` to `FixedPlanServiceRow`.
   - In `resolveFixedPlanLevelBaseRate`, the `service_base_rate` derivation
     (`:253-279`) uses the helper. The catalog fallback (`:281-296`) stays
     per-unit, since catalog prices are unit prices.
   - In `allocateFixedFeeWithoutCatalogPrice`, the first weight becomes
     `fixedMemberContributionCents(base_rate, basis, quantity)`. Rename the basis
     `stored_shares` to `stored_rates` and its label to "Stored per-service
     amounts". `stored_shares` occurs only in this file and its test, so nothing
     persisted depends on the key; `grep -rn stored_shares` confirms this.
     Explanation "Allocation weight" shows the contribution in currency.
   - The non-Fixed edge path (`:1216-1226`) uses the helper, so a share is not
     multiplied by quantity.
   - The seat path (`pricing_basis='unit'`, `:664-807`) is unchanged. It is
     always per-unit and keeps `Math.ceil` rounding through
     `unitFixedServiceAmountCents`.
3. **`billingEngine.ts`**
   - Select `clsfc.base_rate_basis` at both plan-service loads (`:3821`, `:4017`).
   - In the unit-revision overwrite (`:4605-4612`), when `service_base_rate` is
     replaced with the resolved unit rate, also set `base_rate_basis: 'per_unit'`.
   - `isFixedLineUnpriceable` needs no change, because it goes through
     `resolveFixedPlanLevelBaseRate`.
4. **`loadFixedLineRateInputs.ts`**: select `clsfc.base_rate_basis` (`:170`) and
   pass it through `toResolverInput`.
5. **`contractMonthlyValue.ts`**: select `fc.base_rate_basis` (`:176`). The
   bundle `deriveFrom` uses the helper for the `base_rate` derivation; the
   `default_rate` derivation stays per-unit.
6. **Deferred-revenue `loadFixedConfigBaseRates`**: select `fc.base_rate_basis`
   and return the contribution through the helper. Keep the `Math.max(1, qty)`
   clamp for per-unit only; a share is never scaled.
7. **EE simulator** (`loadSimulationCalculationInput.ts:929`, plus the scenario
   types in `packages/types/src/interfaces/contractSimulation.interfaces.ts:64`):
   carry `base_rate_basis` from the scenario's configuration. Wizard-shaped
   scenarios pass `'share'`, and the fact payload (`baseRate`) gains
   `baseRateBasis`.
8. Rate review, reclassification and rollout preview need no code beyond the
   loader in step 4, because they consume `resolveFixedLineRate`.

After this change, `grep -rn "base_rate.*\* *quantity\|service_base_rate.*\*"`
across `shared/billingClients`, `packages/billing/src`, `packages/reporting/src`
and `ee/server/src/lib/billing` should find only the helper and the seat path.
Add a unit test that pins this grep, in the style of the existing `*.contract.test.ts`
source-contract tests.

### 2.4 Fold the `fixed-fee-allocation` LEVERAGE marker

The marker (`computeFixedCharges.ts:454-459`, `:1009-1010`) lists three copies
of the weight → cents split. All of them move onto `allocateCentsByWeights`:

- **Zero-FMV fallback**: already uses it, through the import.
- **Wizard `allocateBundleBaseRate`** (`fixedServiceBasis.ts:143-166`, last
  member absorbs the remainder): reimplement it as `allocateCentsByWeights` over
  the bundle members, keyed by `service_id` and weighted by `quantity ?? 1`.
  This only affects newly authored contracts, where the remainder cent can land
  on a different member than today. Persisted shares are never recomputed, so
  existing contracts, including AJA's, are unchanged.
- **FMV path** (`computeFixedCharges.ts:1011-1033`): today it rounds each member
  independently, so the parts can miss the fee by ±(n−1)/2 cents. Replacing it
  with `allocateCentsByWeights` over FMV weights makes the parts sum exactly to
  the fee. That is a correctness fix, but it changes invoice cents for any FMV
  line whose independent rounding currently misses. See the open question in §8.
  Negative FMV (credit services, test at
  `computeFixedCharges.allocation.test.ts:406-421`) needs care: the allocator's
  floor-and-distribute assumes positive weights. Keep the existing proportional
  path when any weight is negative, or extend the allocator to signed weights.
  The implementation step decides, and the decision must be covered by the
  existing credit test.

Remove both LEVERAGE markers once the three sites share the allocator.

## 3. Writers: every non-NULL `base_rate` write states its meaning

A census was taken on 2026-10-12 against `main` @ d6dc22c273. None of today's
columns separates a share from a per-unit price for non-`unit` rows.
`pricing_basis` is `'bundle'` or NULL arbitrarily: the model's `create` writes
`'bundle'`, while both quote conversions and pre-2026-09-04 rows leave NULL.
Every reader treats `'bundle'` and NULL the same.

### 3.1 The persistence API makes the meaning required

- `ContractLineServiceFixedConfig.create/update`
  (`packages/billing/src/models/contractLineServiceFixedConfig.ts:60-106`) and
  `ContractLineServiceConfigurationService.createConfiguration/updateConfiguration`
  (`services/contractLineServiceConfigurationService.ts:215-223`, `:348-426`)
  change to take a rate value
  `FixedMemberRateWrite = { base_rate: null } | { base_rate: number; base_rate_basis: FixedRateBasis }`.
- `update` recomputes `rate_provenance` together with the rate. Today it writes
  the patch without touching provenance. Setting a rate on an `inherited` row,
  or clearing one on a `custom` row, therefore violates the CHECK from
  `20260912120000` (census note 5: ContractLines inline bundle edit,
  `updateContractLineService`, API `updatePlanService`). The new write type
  fixes this in the same place.
- Raw-SQL writers that bypass the model must stamp the column explicitly:
  `contractLineRepository.cloneTemplateLineToContract`,
  `shared/billingClients/templateClone.ts`, `quoteConversionService`,
  `crmWorkerDal`, and the `rateReviewActions` reset.

### 3.2 Writers and the meaning each stamps

| Writer (file:line) | Value written | `base_rate_basis` |
|---|---|---|
| Wizard `writeFixedLineMembers`, unit member (`contractWizardActions.ts:188-202`) | unit rate | `per_unit` |
| Wizard `writeFixedLineMembers`, bundle member with a line total (`:211-213`, `:228-238`) | `allocateBundleBaseRate` share | `share` |
| Wizard `writeFixedLineMembers`, bundle member with no line total, fixed-mode default (`:214-226`) | per-unit default | `per_unit` |
| Wizard products line (`:1673-1683`) | `0` placeholder (ignored for products) | `per_unit`; stop writing the placeholder if no reader needs it (verify `item_kind='product'` readers) |
| `contractLinePresetActions.copyPresetToContractLine` (`:636-644`) | unit: preset rate; bundle: NULL | `per_unit` / NULL |
| `contractLinePresetActions.createCustomContractLine` (`:913-921`) | dialog `unit_rate`. Bundle rows can carry a stale unit rate because `CreateCustomContractLineDialog` does not clear it when switching back to bundle | unit: `per_unit`. Bundle: write NULL, and fix the dialog so the stale value is dropped |
| `contractLineRepository.cloneTemplateLineToContract` (`:598-761`) | unit rate / template share / quantity-weighted re-split of an edited line rate (`:674-683`) / fixed-mode default (`:693-699`) / NULL | `per_unit` / `share` / `share` / `per_unit` / NULL |
| `shared/billingClients/templateClone.ts:351-376` `cloneTemplateServiceFixedConfig` (rows exist only for unit services) | unit rate | `per_unit` / NULL |
| `quoteConversionService.convertQuoteToDraftContract` (`:817-829`) | unit: `unit_price`; bundle: `round(qty × unit_price)`; product: `unit_price` | `per_unit` / `share` / `per_unit` |
| `crmWorkerDal.convertQuoteToDraftContract` (`:1399-1407`) | `unit_price` on every Fixed row | `per_unit`. Its line rate is `unit_price`, not × qty, which disagrees with `quoteConversionService`; see §7 |
| `contractLineServiceActions.addServiceToLiveContractLine` (`:465-489`) and API `ContractLineService.addServiceToPlan` (`:637-700`) | caller's `type_config.base_rate` | unit: `per_unit`. Bundle: required from the caller, and the API schema (`contractLineSchemas.ts:168-176`) gains `base_rate_basis` for bundle members, defaulting to `per_unit` when absent (the API's documented unit-rate sense) |
| API `updatePlanService` (`:766-805`), `updateContractLineService` (`contractLineServiceActions.ts:703`) | patched rate | keep the row's stored basis unless the patch states one |
| API `copyPlanServices` (`:2107-2163`) | unit rate (bundle dropped) | `per_unit` |
| `ContractLines.tsx` inline edit of an existing bundle member (`:888-896`, labelled "Rate (for tax allocation)" at `:1844`) | edited value | keep the row's stored basis; the label follows the basis ("Share of line fee" or "Rate per unit") |
| `ContractLines.tsx` add-service snapshot (`:903-928`, `ServiceSelectionDialog.tsx:164-181`) | catalog price or `0` | `per_unit` |
| `FixedServiceConfigPanel` / `ContractLineServiceForm.tsx:257` | unit-rate input; bundle rows resubmit the loaded value | unit: `per_unit`; bundle: keep stored |
| `rateReviewActions.resetContractLineRateToStandard` (`:450-458`) | NULL | NULL |
| `contractLineAction.updatePlanServiceFixedConfigRate` (`:624-691`, **no callers**) | — | delete the function |

UI strings changed above go through i18n (`msp/billing` namespace, every locale
file including the `xx`/`yy` pseudo-locales), per `docs/AI_coding_standards.md`
§Internationalization.

### 3.3 Fixed `contract_line_service_configuration.custom_rate`

Presets (`copyPresetToContractLine`), the shared template clone
(`templateClone.ts:166-172`) and the add-service lists
(`FixedContractLineServicesList.tsx:218-233`,
`GenericContractLineServicesList.tsx:220`) store a bundle member's allocation in
the generic configuration `custom_rate`, not in `clsfc.base_rate`. The resolver
reads this column as a per-unit `config_override` (`resolveFixedLineRate.ts:291-300`),
so an inherited template-cloned or preset line also hits the × quantity defect.
The invoice engine never reads it for bundle members.

Decision: a share does not belong in a column shared with Hourly and Usage
rates. The migration (§4) moves every Fixed, non-unit, non-product
`clsc.custom_rate` into `clsfc.base_rate` with `base_rate_basis='share'`,
creating the `clsfc` row if it is missing and keeping its provenance `custom`.
It then nulls the configuration value. Those writers switch to the fixed-config
API. `resolveMemberRate` step 3 is then reached only by unit members and other
configuration types, which are per-unit.

Before writing step 3 of §6, the implementer confirms that the add-service lists
store an allocation (share) and not a per-unit price. If either stores a
per-unit price, it moves with `per_unit` instead.

Money effect: lines with an explicit line rate are unchanged. For inherited
lines, see open question 2 in §8.

## 4. Backfill (money-preserving where the current output is right)

The migration is `server/migrations/2026101200000x_fixed_member_base_rate_basis.cjs`.
Adding the column is additive. The classification runs as a data step in the
same migration, before the constraints are added.

Classification, per contract line, over non-NULL `base_rate` rows:

1. `pricing_basis='unit'` → `per_unit`.
2. Take the line's bundle members (non-unit configs) with non-NULL `base_rate`,
   each with quantity `q_i = COALESCE(clsc.quantity, cls.quantity, 1)` and
   `S = Σ base_rate_i`, `Q = Σ q_i`. Call the line **share-shaped** when every
   bundle member has a non-NULL `base_rate` and every
   `|base_rate_i − S·q_i/Q| ≤ ceil(n/2)` cents. That is the fingerprint of
   `allocateBundleBaseRate`, whose cumulative rounding is bounded by n/2.
3. Label the bundle members:
   - **`share`** if the line is share-shaped and either the quantities are not
     all equal (per-unit rates proportional to quantity are not a plausible
     authoring outcome), or `contract_lines.custom_rate = S` (the wizard's
     line-total fingerprint).
   - **`per_unit`** otherwise. That includes the ambiguous case: all quantities
     equal and greater than 1, share-shaped, and no line rate to compare. This
     keeps today's invoice total for those lines.
4. When all quantities are 1, the two labels bill identically. The rule above
   still picks `share` for wizard-fingerprinted lines, so later quantity edits
   keep wizard semantics.
5. A single-member line is trivially share-shaped. With
   `custom_rate = base_rate` it becomes `share`, which is what quote conversion
   wrote (`round(qty × unit_price)`). With no line rate and quantity > 1 it is
   the ambiguous case and becomes `per_unit` (status quo).
6. Before step 2, the §3.3 move of Fixed bundle `clsc.custom_rate` into
   `clsfc.base_rate` (`share`) runs. Rows it moves are not reclassified.

The migration logs counts per class and lists ambiguous lines (tenant,
contract_line_id) at `info`. A read-only companion script,
`scripts/billing/report-fixed-member-base-rate-basis.ts`, runs the same
classification without writing and prints the before/after derived fee for
every inherited line whose total changes. Run it against a production replica
before merge, and attach the output to the PR.

Money effect, by design:
- Lines with an explicit `contract_lines.custom_rate` keep the same total. Only
  zero-FMV splits change, and only for `per_unit` rows (the symptom 1 fix).
  Wizard rows labelled `share` split exactly as today, so AJA is unchanged.
- Inherited lines with share-labelled members change from Σ share×q to Σ share
  (the symptom 2 fix). The report script enumerates them.

`down` drops the constraints and the column. Nothing else is touched.

## 5. Tests

Unit tests (vitest, colocated):

1. `shared/billingClients/fixedMemberRate.test.ts`:
   - `fixedRateBasisOf`: unit → per_unit, explicit labels, NULL → per_unit.
   - `fixedMemberContributionCents`: per_unit × fractional quantity rounding;
     share ignores quantity.
   - Allocator properties moved from the existing
     `allocateFixedFeeWithoutCatalogPrice` tests: exact sum, ties by key.
2. `resolveFixedLineRate.test.ts`:
   - Inherited line with members `share` 225 (q1) and 675 (q3) derives **900**,
     not 2,250 (symptom 2).
   - Inherited line with `per_unit` 225 (q1) and 225 (q3) derives 900.
   - The `ResolvedRate.basis` is reported for each source.
3. `computeFixedCharges.allocation.test.ts`:
   - Symptom 1: inherited, EUR, `per_unit` ADDON 225×1 and BLKHR 225×3, zero
     catalog prices → total 900, split **225/675**, basis `stored_rates`.
   - Inherited wizard line (`share` 225/675, q 1/3), zero catalog prices →
     total 900, split 225/675.
   - **Mixed taxability, both paths.** Member A is taxable (10%) and member B is
     not. (a) With catalog FMV prices: A's tax equals 10% of A's FMV allocation
     and B's tax is 0. (b) With zero FMV and per-unit members, using the symptom
     1 numbers: A's tax is 10% of 225 and B's is 0. Assert tax per member, not
     just the invoice total.
   - `resolveFixedPlanLevelBaseRate` with share members ignores quantity.
   - Non-Fixed edge path with a share member is not multiplied.
   - The existing FMV, credit and allocation tests stay green. Where the §2.4
     fold changes a cent, update the assertion with a comment showing the exact
     sum.
4. `productionGolden.test.ts` and
   `server/src/test/integration/billing/goldenOutput/goldenOutputBaseline.integration.test.ts`
   must be unchanged for wizard-shaped bundle lines (the AJA shape: line custom
   rate, quantity-proportional `share` members). If the FMV fold moves a cent
   anywhere in the golden set, stop and raise it (§8). Do not re-baseline
   silently.
5. `contractMonthlyValue` and deferred-revenue loader tests: an inherited
   share line is valued at Σ share, and a per-unit line at Σ rate×q.
6. Migration test (integration, `server/src/test/integration/billing/`): seed
   a preset or template-cloned line with Fixed `clsc.custom_rate` allocations,
   and assert they move to `clsfc.base_rate` with basis `share` (§3.3). Also seed
   the four shapes (wizard share line with a line rate; wizard share line made
   inherited; per-unit inherited line; ambiguous equal-quantity line). Run
   classification and assert the labels and constraint enforcement: inserting a
   rate without a basis fails, and so does a `unit` row labelled `share`.

Integration test: extend
`server/src/test/integration/billing/fixedFeeZeroCatalogPrice.integration.test.ts`
with:
- the symptom 1 inherited per-unit line generating an invoice with items
  225/675 and correct per-item tax;
- the symptom 2 flow: wizard create, then the fixed-config editor clears the
  line rate, then generate. The invoice total is 900, matching Estimated monthly.

## 6. Implementation order (one commit per step)

1. The `fixedMemberRate.ts` helper and its tests. Move `allocateCentsByWeights`.
2. Migration: add the column, classify, add the constraints. Add the report
   script and the migration test.
3. Writers: the persistence API type change (§3.1), then every writer in §3.2.
   Move the Fixed `clsc.custom_rate` writers (§3.3) and add the i18n label
   strings.
4. Readers: resolver, compute, engine selects, loader, monthly value, deferred
   revenue, simulator. Add the source-contract grep test.
5. LEVERAGE fold: wizard allocator, then FMV path (behind the §8 answer).
6. Integration tests and golden check.

## 7. Out of scope

- Seat (`pricing_basis='unit'`) rounding (`Math.ceil`) versus bundle per-unit
  rounding (`Math.round`). They differ only for non-integer stored rates or
  quantities and stay as they are. Leave a `LEVERAGE: friction` note if the
  helper ends up needing both.
- Retiring `service_catalog.default_rate`, which is a separate follow-up already
  marked in the resolver.
- `crmWorkerDal` sets a quote line's contract-line rate to `unit_price`
  instead of `qty × unit_price` (`crmWorkerDal.ts:1344`), so it under-bills
  multi-quantity quote lines compared with `quoteConversionService`. This is a
  separate defect; open a follow-up card. This card only makes it stamp
  `per_unit`.
- The column type is `decimal(10,2)` while every path treats the value as
  integer cents. Note this; do not change it here.

## 8. Open questions

1. **FMV-path fold (§2.4).** The fold makes FMV allocations sum exactly to the
   fee. Today each member is rounded independently, and the invoice total can
   miss the contracted fee by up to (n−1)/2 cents. Fixing it is the correct
   choice, but it changes cents on existing customers' invoices from the next
   run. A re-generated historic invoice would also differ from the issued one.
   Ship it in this card, gated by the golden check in §5.4, or split it into its
   own card so this card stays money-neutral for every explicit-rate line? The
   plan assumes **ship in this card**.
2. **Inherited lines whose shares lived in `clsc.custom_rate` (§3.3).** For an
   inherited template-cloned or preset line today, the invoice engine bills
   catalog × qty and ignores those shares. The resolver (Estimated monthly, rate
   review) uses Σ share × qty. After the move, both read Σ share. That is
   consistent with the symptom 2 expectation (an inherited wizard line bills
   Σ share = 900), but it changes the invoice for any such line that exists
   today. The report script (§4) lists them. The plan assumes **Σ share**,
   because one meaning has to hold on both engine and resolver. The alternative
   is to null those shares during the move, so the lines keep following the
   catalog.

## 9. Pre-implementation checklist

- [x] Census of every `clsfc.base_rate` writer and reader (§1, §3.2), taken
      2026-10-12.
- [ ] Confirm that the add-service lists store a share, not a per-unit price, in
      Fixed `clsc.custom_rate` (§3.3).
- [ ] Captain's answers to §8.1 and §8.2. The plan proceeds on the stated
      defaults if none arrive.
