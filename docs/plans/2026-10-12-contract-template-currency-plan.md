# Contract templates carry a currency: per-currency price sets and mismatch fallback

Card 28cb1ead · follow-up to alga-2026-0002371 (PR #3582, merged) · customer: AJA Technologies

This plan is grounded in the code at `d6dc22c273` (origin/main, which includes PR #3582, #3463 and #3492). The branch has been fast-forwarded onto it, so nothing needs to be stacked.

## 1. Where the amounts live today

Migration `20251205130001_remove_currency_from_contract_templates` dropped `contract_templates.currency_code`, but the template tables still store amounts. All are minor units (cents) in `decimal(10,2)` columns. The live DB confirms these columns:

| # | Field | Column(s) | Written by template authoring | Read by the clone |
|---|---|---|---|---|
| A | Fixed line base rate | `contract_template_lines.custom_rate`, `contract_template_line_fixed_config.base_rate` (`0` there means "none") | `contractWizardActions.ts:743-748`, editor | `templateLineRateCents()` `contractLineRepository.ts` |
| B | Fixed bundle member share | `contract_template_line_services.custom_rate`, `..._service_configuration.custom_rate` | `:780-797` | `templateFixedMemberRateCents()` |
| C | Fixed per-seat unit rate | `contract_template_line_service_fixed_config.base_rate` | `:806` | `templateFixedMemberRateCents()` |
| D | Hourly member rate | `..._service_hourly_config.hourly_rate` (also copied to `service.custom_rate` / `configuration.custom_rate`) | `:896-930` | clone, member-rate block |
| E | Usage unit rate | `..._service_usage_config.base_rate` (+ the same two copies) | `:980-1017` | clone, member-rate block |
| F | Line overtime rate | `contract_template_lines.overtime_rate` | editor | clone, copied verbatim to `contract_lines.overtime_rate` |
| G | Service overtime rate | `..._service_hourly_config.overtime_rate` | editor | clone, copied verbatim to `contract_line_service_hourly_config` |
| H | Bucket pool overage | `contract_template_line_buckets.overage_rate` (NOT NULL, default 0) | `:949`, `:1029`, `BucketPoolEditor` | `cloneTemplateLinePools()` `shared/billingClients/templateClone.ts:83`, copied verbatim |
| I | Legacy per-service bucket overage | `contract_template_line_service_bucket_config.overage_rate` | pre-pool templates | clone, legacy bucket branch |

`contract_template_pricing_schedules.custom_rate` exists in the schema, but nothing writes it; only template delete touches it. It stays out of scope. Usage tiers are out of scope too (templates have no tier storage).

### Every path that copies template amounts onto a contract

1. `cloneTemplateLineToContract` (`packages/billing/src/repositories/contractLineRepository.ts`). This is the wizard clone from PR #3582. It is called from `createClientContractFromWizard` (`contractWizardActions.ts` ~1520-1570) and from `addContractLine` (same file, ~line 1050). It copies A/B/C/D/E as the "template value", and it copies F, G, H and I verbatim with no currency check.
2. `fetchTemplateLineViews` (same file). This is the wizard's read-only view. It uses the same precedence but duplicates it (see the `LEVERAGE: pattern template-member-rate` marker).
3. `cloneTemplateContractLine` (`shared/billingClients/templateClone.ts:28`). It copies service `custom_rate` and the line rate, and pools via `cloneTemplateLinePools`. Callers:
   - REST `ContractLineService` (`server/src/lib/api/services/ContractLineService.ts:~1190-1225`). It also copies `templateLine.custom_rate` and `overtime_rate` verbatim into the new `contract_lines` row.
   - `packages/billing/src/lib/billing/utils/templateClone.ts:42` (a wrapper).
   - `packages/clients/src/lib/billingHelpers.ts:105` `cloneTemplateContractLineAsync`, which is used by `clientContractActions.applyContractToClient` (:846) and `clientContractLineActions` (:470-510). That second caller also copies `custom_rate` and `overtime_rate` verbatim.

The card's rule is that an amount is never copied across currencies. That rule applies to all three paths. `packages/clients` depends on `@alga-psa/shared` but not on `@alga-psa/billing`, so the currency resolver must live in `shared/billingClients/` next to `cloneTemplateLinePools`.

### Currency today

- `resolveClientContractCurrency` (`contractWizardActions.ts:~1060`) returns `clients.default_currency_code`, falling back to `default_billing_settings.default_currency_code` and then `'USD'`. An existing draft keeps `contracts.currency_code`.
- `fetchCurrencyCatalogRates` (repository) reads `service_catalog_mode_defaults` and `service_prices` in exactly one currency and never reads the untagged `service_catalog.default_rate`. This rule stays.
- The template wizard and editor print amounts through `useTemplateNeutralRate` (`contracts/templateNeutralRate.ts`), which shows a bare number with no symbol. This plan replaces it.
- The client wizard's TemplateLinesStep (`wizard-steps/TemplateLinesStep.tsx`) shows `template_rate` with the note "From the template (amount is not currency-tagged)". It does not render F/G/H/I at all.
- The unpriced rejection in `createClientContractFromWizard` throws `Cannot create contract in ${cur}…`, which rolls the transaction back. The step shows `wizardTemplateLines.noCurrencyPrice` ("No {{currency}} price for this service…").

## 2. Storage design

### 2.1 `contract_templates.currency_code` (base currency)

Migration `server/migrations/20261012120000_contract_template_currency_and_price_sets.cjs`, created with `npx knex migrate:make … --env migration`, does the following:

1. Add `currency_code varchar(3)` as nullable.
2. Backfill per tenant. Read `default_billing_settings.default_currency_code` for each tenant, falling back to `'USD'`. Then run `UPDATE contract_templates SET currency_code = ? WHERE tenant = ? AND currency_code IS NULL`, parameterized per tenant. That keeps it Citus-safe: no column function in the UPDATE, and tenant in the WHERE.
3. `ALTER COLUMN currency_code SET NOT NULL` with no DB default, because every writer supplies it explicitly.
4. Down: drop the column (and the tables below).

The amounts already stored in the columns from §1 are now read as base-currency amounts. Existing editors keep writing those columns unchanged.

### 2.2 Price sets for currencies other than the base

The design has two new tables, both tenant-first, registered in `packages/db/src/lib/tenantTableMetadata.ts`, in the migration shim `server/migrations/utils/tenantDb.cjs`, and in the tenant-deletion order in `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts` (~line 360), with child rows deleted before the parent.

`contract_template_price_sets` records that a set exists and holds its audit fields:

| column | type |
|---|---|
| tenant | uuid NOT NULL, FK tenants |
| template_id | uuid NOT NULL |
| currency_code | varchar(3) NOT NULL |
| created_at / updated_at | timestamptz NOT NULL default now() |
| created_by / updated_by | uuid NULL |

- PK `(tenant, template_id, currency_code)`.
- FK `(tenant, template_id)` → `contract_templates` ON DELETE CASCADE.
- Also add the `created_by`/`updated_by` columns to the user-delete reassignment list in `packages/users/src/actions/user-actions/userActions.ts:~772`, next to `contract_template_pricing_schedules`.

`contract_template_prices` holds one row per amount slot per currency:

| column | type |
|---|---|
| tenant | uuid NOT NULL |
| price_id | uuid NOT NULL default gen_random_uuid() |
| template_id | uuid NOT NULL |
| currency_code | varchar(3) NOT NULL |
| template_line_id | uuid NOT NULL |
| slot_kind | text NOT NULL, CHECK in the slot kinds below |
| service_id | uuid NULL |
| bucket_id | uuid NULL (template pool id) |
| slot_key | text NOT NULL (derived in code, see below) |
| rate | integer NOT NULL, CHECK `rate >= 0` (minor units, same type as `service_prices.rate`) |
| created_at / updated_at | timestamptz |

- PK `(tenant, price_id)`.
- UNIQUE `(tenant, template_id, currency_code, slot_key)`.
- INDEX `(tenant, template_id, currency_code)`, so one query fetches a whole set (the card's "single lookup").
- FK `(tenant, template_id, currency_code)` → `contract_template_price_sets` ON DELETE CASCADE.
- FK `(tenant, template_line_id)` → `contract_template_lines` ON DELETE CASCADE, so deleting a line removes its prices.
- FK `(tenant, bucket_id)` → `contract_template_line_buckets` ON DELETE CASCADE (nullable).
- No FK on `service_id`. Removing a service from a line deletes its price rows in the same action (§4.3). The resolver walks the template structure and ignores orphans in any case.

Slot kinds and their keys. `slot_key` is built by one function, `templateAmountSlotKey()`:

| slot_kind | key | covers (§1) |
|---|---|---|
| `line_base_rate` | `line:<L>:base_rate` | A |
| `member_rate` | `line:<L>:svc:<S>:rate` | B, C, D, E (meaning depends on line type and pricing basis, matching `TemplateLineServiceEdit.rate`) |
| `line_overtime_rate` | `line:<L>:overtime_rate` | F |
| `member_overtime_rate` | `line:<L>:svc:<S>:overtime_rate` | G |
| `bucket_overage_rate` | `line:<L>:bucket:<B>:overage_rate` | H |
| `legacy_bucket_overage_rate` | `line:<L>:svc:<S>:bucket_overage_rate` | I |

The base currency is never stored in `contract_template_prices`. It stays in the columns, so existing editors, `ensureTemplateLineSnapshot`, and the contract-to-template mapping need no change. The resolver presents base and price-set amounts through the same slot map, so downstream code never needs to know which one it got.

**Which slots exist.** A slot exists only when the base template has a positive amount for that field, or a $0 line rate, which `templateLineRateCents` treats as an intentional snapshot. A field the base leaves empty ("follow the catalog") has no slot in any currency. It keeps today's behaviour: resolve from the client-currency catalog or report it as unpriced. As a result, a template that stores no amounts matches every currency.

**Bundle shares (B) are derived.** A bundle member's share is an allocation of the line rate. A price set may store B explicitly. When it does not, the clone re-splits the line rate by quantity, using the same split it already applies when the wizard edits the line rate (`lineRateEdited`). B is therefore never required. A, C, D, E, F, G, H and I are required whenever their slot exists.

### 2.3 Why this shape

- The design mirrors `service_prices` (per-currency rows, with the base currency carried on the parent), as the card asks.
- One indexed query per (template, currency) gives every amount for that currency.
- Slot keys are built from stable template ids (line, service, template bucket), and cascades keep the rows consistent when the structure changes.
- Base amounts stay where they are, so the change does not require migrating or rewriting every existing editor and snapshot path.

## 3. The resolver: one layer under every clone

The new module is `shared/billingClients/templateAmounts.ts`. It lives in shared so the billing repository, the shared legacy clone and `packages/clients` can all import it. It replaces the duplicated precedence code behind `LEVERAGE: pattern template-member-rate`, and that marker is removed once it is.

```ts
export type TemplateAmountSlotKind = 'line_base_rate' | 'member_rate' | 'line_overtime_rate'
  | 'member_overtime_rate' | 'bucket_overage_rate' | 'legacy_bucket_overage_rate';

export interface TemplateAmountSlot {
  slot_key: string; slot_kind: TemplateAmountSlotKind;
  template_line_id: string; service_id: string | null; bucket_id: string | null;
  base_amount: number;          // cents, in template.currency_code
  required: boolean;            // false only for bundle shares (derived)
}

export interface ResolvedTemplateAmounts {
  template_currency: string;    // base
  target_currency: string;
  source: 'base' | 'price_set' | 'none';  // 'none' = mismatch fallback
  slots: TemplateAmountSlot[];
  amountBySlot: Map<string, number>;      // only amounts valid in target_currency
  price_set_currencies: string[];
}

enumerateTemplateAmountSlots(knex, tenant, templateId): Promise<TemplateAmountSlot[]>
resolveTemplateAmounts(knex, tenant, templateId, targetCurrency): Promise<ResolvedTemplateAmounts>
listTemplateCurrencies(knex, tenant, templateIds[]): Promise<Map<templateId, {base, sets[], incomplete_sets[]}>>
writeTemplatePriceSet(trx, tenant, templateId, currency, amounts: Record<slotKey, number>, userId)
deleteTemplatePriceSet(trx, tenant, templateId, currency)
```

The rules:

- **Base read.** The precedence code is moved here from the repository without changing behaviour: `templateLineRateCents`, `templateFixedMemberRateCents`, and the hourly/usage chain `typed config → configuration.custom_rate → service.custom_rate`, plus F/G/H/I.
- **When `target === base`.** `source = 'base'` and `amountBySlot` holds every base amount. This is PR #3582's behaviour, which is now correct.
- **When a set exists for `target`.** `source = 'price_set'`, and `amountBySlot` holds the set's rows that match a slot in the current structure. Slots the set is missing, because the template gained a line or service after the set was saved, are left unset and fall into the fallback below one by one. They are never filled from the base.
- **Otherwise.** `source = 'none'` and `amountBySlot` is empty.
- `writeTemplatePriceSet` rejects three cases: a currency equal to the base, a slot key that is not in the current structure, and a negative or non-integer rate. It upserts the header and the rows; rows for slots not passed in are left alone.

## 4. Server changes

### 4.1 `cloneTemplateLineToContract`

Add `amounts?: ResolvedTemplateAmounts` to `CloneTemplateLineOptions`. When `currencyCode` is set and `amounts` is not supplied, the clone resolves amounts itself. That covers the `addContractLine` path.

Every amount write reads `amountBySlot`. None reads a template column directly:

- **Line rate.** Precedence is `edits.fixed_base_rate` > `options.customRate` > `amountBySlot[line_base_rate]` > null (inherited).
- **Member rate.** Precedence is edit > line-rate re-split > `amountBySlot[member_rate]` > catalog in the target currency (existing `fetchCurrencyCatalogRates` rules). A line rate that came from a price set or the fallback re-splits bundle shares exactly as an edited rate does, unless the set carries explicit B slots.
- **Overtime (F, G).** Precedence is the new edit field > `amountBySlot` > null. `enable_overtime` and the threshold are still copied; they are not amounts.
- **Pools (H).** `cloneTemplateLinePools` gains an optional `overageRateByTemplateBucketId: Map<string, number | null>`. A missing entry means "unset", which is stored as `0` because the column is NOT NULL, and is reported. Callers that pass nothing must already have resolved the amounts (§4.4).
- **Legacy bucket overage (I).** Edit > `amountBySlot` > 0, and reported when it ends at 0.

`CloneTemplateLineResult` gains `unset_amounts: Array<{ slot_key; slot_kind; template_line_id; service_id; bucket_id; label }>`. This lists every **required** slot that ended with no amount in the target currency. It sits alongside the existing `unpriced_services` and is only populated when a currency is known.

### 4.2 `TemplateLineEdits` (wizard input) gains the missing amount fields

```ts
overtime_rate?: number | null;                       // F
services[].overtime_rate?: number | null;            // G   (TemplateLineServiceEdit)
services[].bucket_overage_rate?: number | null;      // I
bucket_overage_rates?: Array<{ bucket_id: string; rate: number | null }>;  // H, template bucket id
```

A pure helper, `slotAmountsFromEdits(slots, edits[])`, in `templateAmounts.ts`, maps edits to `{slotKey: cents}`. Both the completeness check and "save to template" use it.

### 4.3 `createClientContractFromWizard`

After the template lines are fetched (around `contractWizardActions.ts:1530`):

1. Call `resolveTemplateAmounts(trx, tenant, templateId, contractCurrency)` once and pass the result to every `cloneTemplateLineToContract` call.
2. Collect `unset_amounts` across the lines, in addition to `unpriced_services`. If either list is non-empty, throw. That rolls the transaction back. The message extends the existing one and keeps the same pattern: `Cannot create contract in EUR. The following amounts have no EUR value: "Managed Services — base rate", "Help Desk — hourly rate", … Enter an amount for each, or add EUR rates to the template.` This applies to drafts too, as the current unpriced rule already does.
3. **Learn the currency.** The submission gains `save_template_amounts?: boolean`. When it is true and `amounts.source !== 'base'`:
   - Check the template-edit permission (§6).
   - Build the map from what the clone actually wrote for each required slot. That means the final cents after edits and catalog prefill, read back from the clone results, so the set equals the contract.
   - Call `writeTemplatePriceSet` inside the same transaction.
   - If the permission check fails, reject the request; do not silently skip the save.
   - The flag is ignored when `source === 'base'`.
4. `template_contract_id` handling is unchanged.

**Resume (`getDraftContractForResume`, ~line 2500).** Rebuild the new edit fields as well: line `overtime_rate`, hourly-config `overtime_rate` per service, and pool overage per pool, paired by position the same way lines are. Without this, a resumed fallback draft would come back with its overtime and overage emptied. The new resumed fields need a fidelity test.

### 4.4 Legacy clone paths (the "never copy across currencies" rule)

`cloneTemplateContractLine` (shared) gains a required `amounts: ResolvedTemplateAmounts`. It uses the slot map for the service `custom_rate`, the line rate and pool overage, and it never reads amount columns. The callers resolve it with the contract's `currency_code`:

- `ContractLineService` (REST): also stop copying `templateLine.custom_rate` and `overtime_rate` verbatim into the insert. Use `data.custom_rate ?? amountBySlot[line_base_rate]` and the slot value for overtime.
- `clientContractLineActions` (:470-510): same as `ContractLineService`.
- `applyContractToClient`: resolve with the contract's currency.
- The billing `utils/templateClone.ts` wrapper: pass through.

These paths have never rejected an unpriced line, so they keep that behaviour. Unset amounts stay unset: Fixed is `inherited`, Hourly/Usage use the catalog in the currency or 0, overage is 0. They are not rejected. Update the `template-clone-substrate` LEVERAGE markers to say the paths now share the amount layer but still duplicate structure copying.

### 4.5 Read actions

- `listContractTemplatesForWizard`: add `currency_code` and `price_set_currencies` to each option, via `listTemplateCurrencies`, which is a single query.
- `getContractTemplateLinesForClientWizard`: also return `template_currency`, `amount_source` (`'base' | 'price_set' | 'none'`) and `can_save_template_amounts`, which is the permission result from §6.
- `fetchTemplateLineViews`: build each line view from `resolveTemplateAmounts` plus catalog rates. Each amount field the view exposes becomes:

  ```ts
  { slot_key, template_amount: number | null /* base cents, in template_currency */,
    amount: number | null /* resolved in target currency */,
    catalog_amount: number | null /* client-currency catalog, member_rate only */, required: boolean }
  ```

  It covers the line base rate, member rate, both overtime rates, pool overage (one entry per pool, with its name) and legacy overage. This replaces `template_rate`, `currency_rate` and `fixed_base_rate`, and the `LEVERAGE: pattern template-member-rate` marker goes away.

### 4.6 Template authoring and editor actions

- `createContractTemplateFromWizard` (`contractWizardActions.ts:544`): `ContractTemplateWizardSubmission.currency_code` is now required. The UI always sends it; the server validates it as an ISO-4217 code and writes it. Remove the "currency-neutral" comments here (:283, :300, :582) and in `TemplateOption`.
  - **Hidden USD snapshot.** At :601 the action sets `const templateCurrencyCode = 'USD'`. It uses that to look up `service_catalog_mode_defaults`, then falls back to the untagged `service_catalog.default_rate` (:627, :769, :898, :982), and copies the result into the template's member rates. So today the wizard writes USD catalog prices into templates.
  - **Fix.** Resolve snapshot rates in `submission.currency_code` through `fetchCurrencyCatalogRates`: the mode default first, then the current `service_prices` row. Never use `default_rate`. A service with no price in the template currency gets no snapshot rate; the member follows the catalog.
- `addServiceToTemplateLine` (`contractLineServiceActions.ts:275-357`) falls back to `service.default_rate` (:298-302). Apply the same fix: resolve in the template's currency through `fetchCurrencyCatalogRates`, otherwise leave it null.
- `ensureTemplateLineSnapshot` (`contractLineMappingActions.ts:131-450`, plus the repository copy at `contractLineRepository.ts:224-286`) copies a **live** contract line into a template. That line is priced in its contract's currency.
  - If the contract currency equals the template's base, write the base columns as today.
  - Otherwise reject with "This line is priced in EUR; the template's base currency is USD." Never write amounts into a currency they do not belong to. (Writing them as a EUR price set would leave the base slots empty, which is not a valid template.)
- **USD placeholders become `template.currency_code`:**
  - `contractActions.ts:164` (`mapTemplateToContract` forces `currency_code: 'USD'`)
  - `contractActions.ts:1079` (`getContractOverview` template branch)
  - EE `ee/server/src/lib/billing/simulator/snapshotContractToScenario.ts:174-191`
  - `ContractTemplateDetail.tsx:1975-1983`: the overage display uses an undeclared `defaultCurrency`, which `@ts-nocheck` hides.
- **i18n for the server error.** "Cannot create contract in X…" is a raw `Error` today (`contractWizardActions.ts:1460`, :1566) that `contractWizardActionErrors.ts:58` passes through with no i18n key. The new template-amount error and the existing unpriced error both become keyed errors with params (`errors.wizard.currencyPricingMissing`, `errors.wizard.templateAmountsMissing`) so the client renders them in every locale. This happens in the same change.
- New actions in `packages/billing/src/actions/contractTemplatePriceSetActions.ts`, each behind the permission in §6:
  - `getContractTemplatePricing(templateId)` returns the slots, base amounts and every set.
  - `saveContractTemplatePriceSet(templateId, currency, amounts)`.
  - `deleteContractTemplatePriceSet(templateId, currency)`.
  - `updateContractTemplateCurrency(templateId, newCurrency)` relabels the base. It does not convert amounts. It is rejected when a price set already exists for `newCurrency`; the UI offers to delete that set first.
- **Service removal from a template line.** Every action that removes a service from a template line also deletes that service's `contract_template_prices` rows. Pool and line deletes cascade. The editor-action inventory is in §8.

## 5. UI changes

### 5.1 Template wizard (`contracts/template-wizard/TemplateWizard.tsx`, its steps, `TemplateReviewContractStep`)

- Add a currency select on the basics step, defaulting to the tenant default currency (`default_billing_settings.default_currency_code`). It sends `currency_code`.
- Every amount input and every review line uses the template currency's symbol and fraction digits.
- `useTemplateNeutralRate` is deleted and replaced by a `useTemplateMoney(currency)` hook, which is a thin wrapper over the existing currency formatter, used in the wizard and the editor.
- The translated string `templateReview.fixed.unitRateNeutral` is removed or reworded.

### 5.2 Template editor (`ContractTemplateDetail.tsx`)

- **Header.** A base-currency badge (for example "USD") and a "Change base currency" action. Its confirmation says that amounts are relabelled, not converted.
- **New "Pricing" section.** A slots × currencies grid:
  - Rows are grouped by line, and each row is labelled by field ("Managed Services · Help Desk · hourly rate").
  - The base column is read-only here and shows the amount formatted in the base currency. Base amounts are still edited in the existing line editors.
  - Each price-set column has editable cents inputs.
  - Actions: "Add currency" (choose from the enabled currencies other than the base and the existing sets) and "Remove currency" with a confirmation.
  - Required slots that are empty in a set are flagged ("missing"). This is the "currency column" option from the card. It covers every slot kind in one place, without bending each line editor.
  - It is modelled on the per-currency price editing for services (component listed in §8).
- **Existing line editors.** Show amounts in the base currency, using `useTemplateMoney`, instead of a bare number.

### 5.3 Client wizard: picker (`ContractWizard.tsx` template select)

- Each option shows currency badges, base first ("USD · EUR").
- Once the client, and so the contract currency, is known and the template has neither a matching base nor a matching set, the option shows the hint "Needs EUR rates". The option stays selectable and is never hidden.
- If the template is chosen before the client, the hint appears as soon as a client is picked. The wizard step order is in §8.

### 5.4 Client wizard: TemplateLinesStep

- **Per-field rendering.** Every amount field is rendered from the view in §4.5: the line base rate, member rates, line and member overtime, and pool and legacy overage. The step gains the overtime and overage inputs it lacks today.
  - **`amount_source = 'base' | 'price_set'`.** The field shows the resolved amount as today. The note becomes "From the template (USD)" or "From the template's EUR rates". The "not currency-tagged" note (`wizardTemplateLines.templateRateNote`) is removed.
  - **`amount_source = 'none'`, or a slot missing from a partial set.** The field is empty in the client currency, with the reference "Template: $2,500.00 USD" beside it, formatted in the template currency. When `catalog_amount` exists, it is pre-filled into the edit (sent as an edit, so the server writes exactly what is shown) and labelled "Catalog price".
- **Blocking.**
  - A required field left empty shows the existing amber pattern: "No EUR amount. Enter one or the contract cannot be created."
  - The wizard's step validation (`ContractWizard.tsx`, where `noCurrencyPrice` is enforced today) blocks Next and Create until every required field is filled.
  - The server check in §4.3 is the backstop.
- **Alert.** An alert at the top of the step in fallback mode reads: "This template has no EUR rates. Its structure is copied; enter EUR amounts below. Template amounts are shown for reference only and are not converted."

### 5.5 Client wizard: Review & Create (`ReviewContractStep` / `TemplateLinesReview`)

- When `amount_source !== 'base'` and `can_save_template_amounts` is true, show the checkbox "Save these EUR rates to the template" (unchecked by default). It sends `save_template_amounts`. For a partial set the label is "Add the missing EUR rates to the template".
- The checkbox is hidden when the permission is missing.
- `TemplateLinesReview` lists the amounts that will be written, in the contract currency.

### 5.6 i18n

New and changed keys go in `msp/contracts` (and in `msp/billing` if the Pricing section lives there), in **every** locale under `server/public/locales/*/`, including `sv` (the locale list is in §8). Keys include:

- `wizardTemplateLines.fallbackAlert`, `templateReference`, `catalogPrice`, `fromTemplateCurrency`, `fromTemplatePriceSet`, `noCurrencyAmount`, `overtimeRate`, `bucketOverageRate`
- `wizard.templatePicker.needsRates`
- `review.saveTemplateRates`, `review.saveMissingTemplateRates`
- `templateWizard.currency`
- `templateDetail.pricing.*` (title, addCurrency, removeCurrency, missing, baseCurrency, changeBaseCurrency, changeBaseConfirm)
- server error keys: `errors.wizard.templateAmountsMissing`, `errors.templatePricing.*`

Remove `templateRateNote` and `templateReview.fixed.unitRateNeutral` from every locale.

## 6. Permissions

There is no template-specific RBAC resource. Every template mutation checks `billing`:

| Action | Permission |
|---|---|
| Create a template | `billing:create` + `billing:update` (`contractWizardActions.ts:554`) |
| Update a template (`updateContract`, `updateContractLineRate`, `updateContractLineAssociation`) | `billing:update` (`contractActions.ts:130/444/409`) |
| Add a line or service | `billing:create` |
| Remove a service | `billing:delete` |
| Delete a template | `billing:delete` |

The rules for price sets:

- **"Save to template" and `saveContractTemplatePriceSet` / `updateContractTemplateCurrency`** require `billing:update`. `deleteContractTemplatePriceSet` requires `billing:delete`.
- **`can_save_template_amounts`** is computed server-side as `hasPermission(user, 'billing', 'update')`, and the server re-checks it before writing. The client wizard already requires `billing:update`, so in practice the checkbox is shown to every wizard user. The check is still written explicitly, so a later split of template permissions only touches one place.

## 7. Tests

### Integration tests (real DB; `server/src/test/integration/`)

`createContractFromTemplate.integration.test.ts`:

- **Existing fixtures.** The test at :481 ("clones every template line faithfully for a non-USD client") builds a template and a EUR client. Its template must now carry `currency_code: 'EUR'`, or a EUR price set, or it falls into the fallback path. Update the fixtures, not the assertions.
- **USD → USD.** A USD template used for a USD client clones verbatim: A, C, D, E, F, G and H all equal the base, and `template_contract_id` is set.
- **USD + EUR set → EUR client.** The EUR amounts land on the contract, every slot kind included (line rate, unit rate, hourly, usage, both overtime rates, pool overage, legacy overage). No USD amount lands.
- **USD-only → EUR client, nothing entered.** Creation throws `Cannot create contract in EUR…` listing every required slot, and no contract, line or `client_contracts` row remains (rollback).
- **USD-only → EUR client, with a EUR catalog price.** The view returns `catalog_amount` for the member slots. A submission with edits for all slots succeeds, and no USD amount lands; assert each column ≠ the USD base value where they differ.
- **Save to template.** The above with `save_template_amounts: true` creates a `contract_template_price_sets` row and a `contract_template_prices` row per required slot. A second EUR client then clones verbatim (`amount_source = 'price_set'`) with no edits.
- **Save to template, no permission.** The save is rejected and the transaction rolls back.
- **Partial set.** A line is added to the template after the EUR set was saved. The new line's slots are required, and the old slots clone from the set.
- **Bundle shares.** A EUR set with only the line rate re-splits the bundle shares by quantity.
- **`addContractLine` mismatch.** No USD amount lands. Hourly and Usage get the EUR catalog price or 0, Fixed is `inherited`, overage is 0, and nothing throws.
- **Legacy paths mismatch.** `cloneTemplateContractLine` via `applyContractToClient`, and `ContractLineService`, copy no USD amounts.
- **Resume.** A fallback-mode draft keeps its line and member overtime and its pool overage on resume, and re-saves unchanged.
- **Picker.** The picker returns `currency_code` and `price_set_currencies`.

`contractTemplateWizardCurrency.integration.test.ts`:

- Flip the `not.toHaveProperty('currency_code')` assertions: the template now persists the submitted currency.
- A template with no currency, or with a code that is not ISO-4217, is rejected.
- A EUR template's snapshot member rates come from EUR `service_prices` or mode defaults, never from `default_rate` or USD (this is the fix for the hardcoded `'USD'` at :601).
- `ensureTemplateLineSnapshot` of a EUR contract line into a USD template is rejected.
- The "inherits template currency (EUR)" and JPY tests: assert that the contract is in the client's currency and that amounts follow the §3 rules.

Migration test (`server/migrations/__tests__/` style): backfill per tenant default, the fallback to `USD`, NOT NULL afterwards, and a clean down migration.

### Unit tests (packages/billing/tests, vitest)

- `templateAmounts`: `enumerateTemplateAmountSlots` produces the right slot set for each line type, and `$0` line rate and per-seat members are handled. `slotAmountsFromEdits` round-trips.
- TemplateLinesStep: fallback rendering shows the reference in the template currency, the catalog prefill is labelled, and Next is blocked until all fields are filled. A matching set renders without the reference.
- Picker badges and the "needs EUR rates" hint.
- Template wizard: the currency defaults to the tenant default, and amounts are formatted in the template currency.

## 8. UI surface inventory (from the code survey)

All paths are under `packages/billing/src/components/billing-dashboard/contracts/` unless stated otherwise.

**Template wizard.** `template-wizard/TemplateWizard.tsx` is opened from `TemplatesTab.tsx:238/271` and `Contracts.tsx:592/908`.
- It has 6 steps and submits at :379.
- The basics step is `steps/TemplateContractBasicsStep.tsx`; the old currency selector was removed at :10/:116-118. The currency select goes back here, using `@alga-psa/ui/components/CurrencyPicker`, defaulting to `getTenantDefaultCurrencyCode()` (`actions/billingCurrencyActions.ts:19`).
- Amount inputs in the wizard:
  - the per-seat unit rate (`TemplateFixedFeeServicesStep.tsx:382`, help text :396 "catalog price in the client's currency")
  - bucket overage (`BucketOverlayFields.tsx:36,160`, which uses the tenant-default `symbol()` and must use the template currency)
- `TemplateReviewContractStep.tsx` uses `useTemplateNeutralRate` (:24, :235) and a hardcoded `$` in `templateReview.bucket.overage` (:74-76; the `$` is in every locale string). Both move to the template currency.

**Template editor.** `ContractTemplateDetail.tsx` (2143 lines, `@ts-nocheck`) is routed via `ContractDetailSwitcher.tsx:135,187`.
- The summary row "Currency = Client's currency" (:1257-1262, `templateDetail.summary.clientCurrency`) becomes the base currency plus price-set badges and the "Change base currency" action.
- `TemplateServicesManager` (:2012-2140) has "Edit Rate" on Fixed lines (:2101). It opens `ContractLineEditDialog` (:2128) without `currencyCode`, which is neutral mode (`ContractLineEditDialog.tsx:27-58`). Pass the template currency instead.
- `GenericContractLineServicesList` (read-only here, :2117) assumes `'USD'` (:84, :140). Pass the template currency.
- The new Pricing section goes beside `TemplateServicesManager`. It is modelled on the "Multi-Currency Pricing" block in `components/settings/billing/ServiceCatalogManager.tsx:1378-1520`: `CurrencyPicker` + symbol-prefixed input + Remove, and "+ Add Currency".

**Client wizard.**
- The picker is `wizard-steps/ContractBasicsStep.tsx:126-128` (options) and :192-240 (select and preview). Data comes from `ContractWizard.tsx:448` → `listContractTemplatesForWizard`.
- The client picker on the same step sets `currency_code` (:254-257). So both the template and the client currency are known on step 1, and the "needs EUR rates" hint can be computed there.
- The template lines view is loaded at `ContractWizard.tsx:563-611` and the step is rendered at :1193.
- The template-mode review is `ContractWizard.tsx:1212-1235` with `TemplateLinesReview`. The checkbox from §5.5 goes there.

**Locales.** Each of `server/public/locales/{de,en,es,fr,it,nl,pl,pt,sv,xx,yy}/msp/contracts.json` gets every new key, including the `xx`/`yy` pseudo-locales. Every existing key that hardcodes `$` (`templateReview.bucket.overage`) is reworded to take a formatted `{{amount}}`.

## 9. Implementation order

1. Migration, table registration (metadata, shim, tenant deletion, user reassignment), and the migration test.
2. `shared/billingClients/templateAmounts.ts` with unit tests.
3. The repository clone and view on the resolver, plus the new edit fields and `unset_amounts`.
4. `createClientContractFromWizard`: resolve, check completeness, save to template, resume. Integration tests.
5. The legacy clone paths (§4.4), with their tests.
6. Template authoring currency and the price-set actions.
7. UI: template wizard, editor Pricing section, picker, TemplateLinesStep, Review.
8. i18n in every locale, then a browser pass of the three acceptance scenarios on the dev server.

## 10. Open questions

1. **Backfill currency for templates whose amounts came from USD catalog prices.** The card says existing templates get their tenant's default currency. But the template wizard has always snapshotted catalog rates with a hardcoded `'USD'` (`contractWizardActions.ts:601`, plus the USD-backfilled `default_rate`). So on a tenant whose default is not USD, wizard-snapshotted member rates are really USD amounts. Amounts typed into the editor were probably meant in the tenant currency. The plan follows the card: tenant default for every template. Alternative: back-fill `'USD'` for templates on non-USD tenants whose amounts match their USD catalog snapshot. That is heuristic and not recommended. Captain to confirm.
2. **Scope of the legacy clone paths (§4.4).** The card names only `addContractLine`. The REST `ContractLineService` and `packages/clients` (`applyContractToClient`, the add-client-contract-line action) also copy template amounts verbatim. The plan includes them under the "never copy across currencies" rule. Proceeding unless told otherwise.
