# Configure tax rate caps

- Date: 2026-09-17
- Status: First draft implemented and verified; see [validation and review notes](VALIDATION.md)
- Card: `14e00aa1-7563-48b6-b548-3dc8c447d663`
- Dependency: parent card `8d576a75-24b2-42cd-9758-f6a9e1aa9d76`, PR #3391

## Problem and outcome

Administrators can create and edit tax rates, but cannot inspect or configure the monetary cap already stored on each rate. Existing caps can affect tax without appearing anywhere in the Tax Rates screen. Administrators need to set, edit, clear, and intentionally set a zero cap through Billing > Tax Rates, then see the result in a draft invoice.

This work extends the parent persistence and calculation contract. It does not replace its tax engine or resolve jurisdiction policy by changing arithmetic. The source contract is [Tax caps and period-spanning tax](../../../../docs/billing/tax/tax_caps_and_period_spanning.md).

## Goals and boundaries

Provide one consistent cap contract across forms, actions, public schemas, rate responses, types, formatting, and documentation. Preserve existing uncapped calculations and billing authorization. Make cap scope and currency explicit, including limitations of composite calculations.

Do not add project billing caps, per-component caps, invoice-wide caps, foreign-exchange conversion, a period-calculation UI, or new public tax-rate mutation endpoints. Do not change segment boundaries, rounding, progressive thresholds, tax precedence, exemption behavior, or jurisdiction policy. Small integration changes that deliver the existing parent cap calculation to invoice callers are prerequisites, not a new calculation design.

## Decisions

### D1. Associate a capped rate with an explicit invoice currency

The checkout corrects a premise in the commissioning brief: `server/migrations/20251118134500_add_multi_currency_support.cjs` already adds nullable `tax_rates.currency_code`. An explicit code restricts the rate to that invoice currency; NULL means universal. `TaxService` already uses this filter in default, regional, and period selection. Reuse this column. No new currency or cap column is needed.

A newly set or changed non-null cap, including zero, requires an explicit supported currency on the effective saved row. The UI uses major units of that currency; storage and API `cap_amount` use integer minor units. There is no exchange conversion. Tenant base currency is not a valid implicit interpretation because a tenant can invoice in several currencies and universal rates can match all of them. Changing tenant base currency must not reinterpret an existing cap.

Expose a **Rate currency** picker with **All invoice currencies** representing NULL. Explain that selecting a currency restricts the entire rate, not just its cap. Do not silently select USD or the tenant default. Show ISO codes in the picker, field label, and saved monetary display. Reuse the shared currency picker and metadata, extending the supported options if needed for a three-fraction-digit currency; retain valid stored currencies when hydrating even if absent from the usual shortlist. Validate codes against shared supported currency metadata, not merely a three-letter regex or Intl's acceptance of arbitrary codes.

Changing currency with a nonblank amount requires explicit re-entry of the amount in the new currency; do not reinterpret or convert old text automatically. Preserve the draft until the user supplies the replacement. Clearing a cap retains the existing rate currency; returning the rate to All invoice currencies is a separate deliberate change.

**Legacy capped universal rows:** do not backfill a guessed currency or disable their calculation. Display `Currency not specified · {{amount}} minor units`, including zero, and explain that the same integer currently applies in each invoice's minor units. The edit form shows this stored value separately, offers currency resolution or Clear tax cap, and does not pretend the unresolved value is a blank uncapped field. An unrelated edit omits both fields and preserves them. A deliberate cap change requires an explicit currency. Resolving currency without changing the minor amount must be an explicit action with a visible major-unit preview. Clearing remains available without currency resolution. An explicitly resubmitted unchanged legacy pair may be preserved after comparison with the stored row; never use truthiness to decide this.

### D2. Describe the actual scope where the amount is entered

Label the field **Tax cap ({{currencyCode}})** with **Optional** beside it. Inline guidance: “Maximum tax from this rate for each calculation. Leave blank for no cap. Enter 0 to charge no tax on paths that use this cap.”

A keyboard-accessible **How tax caps apply** disclosure explains:

- A regional calculation caps each rate's contribution before combining tax. It does not cap the combined regional total.
- A period calculation applies the cap separately to each rate in each date segment. Several segments can together exceed the entered amount.
- An invoice may run several tax calculations. This is not an invoice, client, project, or whole-period aggregate limit.
- A project billing cap limits project billable amounts; a tax cap limits the calculated tax contribution.
- Caps govern internal tax calculations. External tax providers follow their own configuration.

Keep the basic amount, blank/zero meaning, and currency applicability visible without opening help. Place the fuller explanation in the disclosure and detail panel.

### D3. Preserve blank, zero, omission, and exact amounts

`cap_amount` remains nullable bigint in PostgreSQL. The supported application range is 0 through `Number.MAX_SAFE_INTEGER` (9007199254740991) minor units. NULL means uncapped; zero means a real zero cap on supported paths. PostgreSQL's larger bigint range is not the public application range.

Use string form state and a shared strict decimal conversion helper. Reuse `currencyFractionDigits` and the existing money-helper module, extending it with exact string/BigInt conversion and exact formatting where necessary. The existing `toMinorUnits(number)` multiplies floating-point values and rounds; the existing `CurrencyInput` strips malformed characters and calls `parseFloat`. Neither is suitable unchanged for this field. Keep their existing callers backward compatible.

Accept ungrouped digits with the active locale's decimal separator and at most the currency's fraction digits, with outer whitespace trimmed. Use a localized example beside the input. Do not accept grouping separators, currency symbols, exponent notation, sign prefixes, embedded whitespace, mixed separators, hexadecimal, Infinity, NaN, or trailing garbage. Reject negative values, excess precision (including extra trailing fractional zeros), and overflow; never round user input into validity. USD permits two fraction digits, JPY zero, and BHD three. Derive digits from shared currency metadata, not a hardcoded factor of 100.

Construct the minor-unit integer exactly, validate its range, then convert to a safe number for actions. Hydration and display must also remain exact at the maximum: USD 90071992547409.91, JPY 9007199254740991, BHD 9007199254740.991. A formatted symbol alone is insufficient: always show the ISO code.

Blank or an explicit Clear tax cap action sends NULL. Zero sends 0. An untouched cap/currency pair on edit is omitted. Dirty checking compares canonical values and field presence, distinguishing NULL, 0, and unresolved legacy state; changing textual formatting alone does not change the persisted cap. Cancel/reopen resets draft values and errors. Failed saves retain entered text. Disable duplicate submission and refetch after success.

Normalize raw database bigint strings at action/response boundaries. Validate integer strings before numeric conversion so rounded fractional strings and malformed numeric notation cannot become valid integers accidentally. Keep runtime validation in actions even when the UI has already validated.

### D4. Composite rows expose a row cap with a visible limitation

`calculateCompositeTax` sums component tax without applying the parent row's cap. Regional calculations instead use each selected row's percentage and cap; the `is_composite` label does not change that path. Keep this behavior unchanged.

Allow viewing, setting, editing, and clearing the row cap on composite rows, but show a persistent notice beside the input and saved cap: “This cap applies when this rate contributes to a regional calculation. Component-based calculations do not apply this cap.” The Components tab repeats the limitation. Never render a cap input per component or label the cap as a ceiling on the component total. Zero on a composite row must not promise all tax becomes zero. Test both paths to prevent copy and behavior from diverging. Whether to cap component totals is a separate domain-review decision.

### D5. Expose cap and currency in public schemas in this release

Extend base/create/update/response/advanced tax-rate schemas and their inferred types with `cap_amount` and `currency_code` consistently. Requests use a JSON safe integer in minor units, or NULL; numeric strings and major-unit decimal numbers are not API input. Raw PostgreSQL strings are normalized before response validation. Responses include explicit NULL or integer cap values and explicit NULL or ISO currency codes, including legacy unresolved pairs.

Create omission means no cap and universal currency. On update, omission preserves each stored field; explicit cap NULL clears it. Do not add an update default or transform that collapses missing into NULL. Pair validation uses the effective row loaded within the authenticated tenant: setting a cap can reuse the stored explicit currency, while setting currency NULL with a remaining cap is rejected except preservation of an unchanged legacy pair. Clearing both fields together is valid. Existing uncapped clients need not send new fields.

The current `/api/v1/financial/tax/rates` route exposes GET only and calls the generic financial `list()` backed by transactions. Correct that route to return tenant-scoped tax-rate rows with existing financial authentication/permission checks plus the billing-read/product-access restrictions used by the actions. Verify the actual response body, pagination/filter contract, and schema. Do not describe schema additions as newly available POST/PATCH endpoints. Update API documentation/OpenAPI registrations and any generated artifacts that actually consume these schemas; TypeScript request/response aliases here are `z.infer` types, not a separate hand-maintained SDK. Inventory remaining generated consumers during implementation and record the result.

### D6. Shared editions and existing access rules

The screen lives in shared `packages/billing`; the MSP composition imports that screen. Both currency and cap migrations live in the base `server/migrations` tree, inherited by CE and EE. Do not make the field EE-only or add an EE-only migration. Verify both supported schema paths contain the parent fields before smoke testing; a missing parent migration is a deployment dependency, not permission to recreate it.

Retain authenticated tenant-scoped reads and billing `read`, `create`, and `update` checks in actions, with the existing PSA product-access guard. Present Add and Edit/Save according to those permissions and pass read-only state into the detail editors. A billing-read-only user can inspect all cap states; row clicks must not expose an enabled save path. No-read users cannot retrieve the rates. Direct forged calls must fail without changing data, and user-supplied tenant identifiers must not select another tenant.

### D7. Preserve parent arithmetic while completing invoice integration

Manual invoice regional calculation already passes currency into `TaxService`. Some callers in `actions/invoiceGeneration.ts` and `actions/billingAndTax.ts` omit it. Thread the actual invoice/charge currency through affected call chains and previews. Never substitute tenant base currency when the invoice has an explicit currency.

`lib/billing/compute/taxContext.ts` also has a preloaded regional calculator whose rate model omits cap and whose arithmetic is still uncapped. Trace its production draft-invoice usage and carry `cap_amount` through its loader and model. Reuse the parent's pure regional contribution calculation from a shared billing helper, preserving its exact rational arithmetic and uncapped fast path; do not independently reimplement cap math. Cover previews and persisted drafts that use this path. Existing treatment of missing rates, exemptions, and reverse charge stays unchanged.

The user-facing configuration is complete only when the selected real invoice flow uses the saved value. Unit tests of `TaxService` alone cannot demonstrate that.

## Administrator experience

1. Open Billing > Tax Rates. Add a **Tax cap** table column immediately after percentage. Show `No cap`, a currency-coded amount, or the legacy unresolved state. Composite capped rows carry a text limitation indicator, not just color or an icon.
2. Choose Add or Edit. After the percentage, group Rate currency, Tax cap, Clear tax cap, and concise guidance in a compact section. Keep description and validity dates below. Use one amount field, with no extra “enabled” toggle that could confuse zero with disabled.
3. Choose a currency when configuring a cap. State: “This rate will apply only to invoices in {{currencyCode}}.” For an existing universal rate, explain before save that other invoice currencies will no longer select it. The parent default path can return zero if no matching default rate remains; do not promise an automatic replacement rate.
4. Enter an amount using the localized decimal example. Validation appears beside the field and in the submission summary, with focus moved to the first invalid field. Server validation maps to localized cap/currency errors rather than raw English messages.
5. Save, reload, and reopen. The list, form, and Advanced Settings > Details show the same exact amount and currency. Clear sends NULL; zero stays visibly zero. Save/cancel remain in the shared dialog's sticky footer.
6. In Advanced Settings, show the cap and currency beside percentage in Details. Keep editing in the main Add/Edit dialog to avoid competing save flows. Components retain their existing editors and gain the cap limitation text.

Use shared inputs, labels, picker, dialog, and accessible disclosure components with unique IDs. Connect helper/error text with `aria-describedby`, use `aria-invalid`, keep help and clear actions keyboard operable, and restore focus when closing. Stack the currency and amount fields on narrow screens; the table can use its existing horizontal overflow, while details preserve an accessible cap readout. Verify 360px and desktop layouts, light/dark themes, and long translations.

## Localization and documentation

Add keys consistently to the existing `msp/service-catalog` and action-error `msp/billing-settings` namespaces for en, de, es, fr, it, nl, pl, pt, xx, and yy. Use the repository's pseudo-locale conventions for xx/yy. Cover labels, empty/zero/legacy states, scope help, currency changes, composite notices, and specific malformed/negative/precision/range/currency validation. Do not rely on English default strings as the only production translation.

Update the parent contract's “no UI” and schema statements, currency explanation, composite limitation, and stale interface comments. Add a user guide under `docs/billing/tax/` covering actual navigation, units, set/edit/clear/zero, explicit currency applicability, legacy resolution, per-calculation/per-segment scope, external tax, and the distinction from project billing caps. Include API minor-unit examples and omission/NULL semantics in API documentation.

## Delivery and verification

Implement in this order: shared value/types contract; action validation and normalized reads; schema/GET response alignment; invoice adapters using parent math; UI, locale keys, and user documentation; automated and live validation. About 30 implementation items and a smaller set of representative tests are appropriate; money precision, authorization, and preservation cases receive explicit coverage.

Keep the parent branch dependency until PR #3391 is merged, then rebase normally. Do not cherry-pick a second cap migration onto main. No data backfill is planned. Existing legacy capped rows retain their values and calculation behavior until explicitly changed. The existing region-wide date-overlap validator prevents adding overlapping currency-specific rates through actions; this plan does not change that rule or promise a full per-currency rate-management redesign.

Run DB-backed integration against the migrated schema for action round trips, guards, bigint hydration, tenant isolation, and invoice results. Keep existing parent tax suites green. Form tests exercise rendered controls and submitted payloads, not source-string assertions. Use the linked `features.json` and `tests.json` as implementation checklists; all remain false at planning time.

For live smoke, use the real Tax Rates screen and internal-tax draft-invoice UI on the card's wired environment. Set up a fictional taxable client, service, region, and invoice currency without changing cap columns directly. Capture screenshots, rate/invoice identifiers, and expected/actual totals. On fresh equivalent drafts with one taxable amount of 100.00 and a 10% rate in a two-digit currency, demonstrate uncapped 10.00, cap 5.00 yielding 5.00, edited cap 3.00 yielding 3.00, clear yielding 10.00, and zero yielding 0.00. Reload and reopen between changes. Do not assume an old draft is automatically recalculated; use the supported recalculate flow or a new draft each time. A second calculation/region or automated equivalent must show that the cap is not invoice-wide. Include read-only denial and currency precision checks. The period path remains covered by automated tests; no production period UI is required.

## Review items and risks

- **Jurisdiction review remains open:** parent per-rate versus aggregate scope, per-segment reset, progressive thresholds, coverage gaps, and ceiling rounding have not been certified for particular jurisdictions. This UI describes existing mechanics and does not imply legal suitability.
- **Composite total caps remain unsupported:** enabling a row cap does not cap component-based totals. Any decision to change that requires a separate calculation design.
- **Currency applicability is material:** choosing a currency can remove a previously universal rate from other invoices. The UI must explain this before save; legacy values cannot be assigned a currency by migration guesswork.
- **Currency propagation and alternate compute path are prerequisites:** a UI-only patch can make invoices miss the rate or ignore its cap. Implement the bounded adapters above and verify persisted drafts.
- **GET route correction changes an erroneous response:** the current tax-rates route delegates to transaction listing. Document this correction and test its resource/permission contract; do not expand it into unrelated financial API work.
- **Maximum-safe money requires exact formatting as well as parsing:** number division can lose the last displayed minor unit even after a correct parse.

These are recorded design/release review items. Planning completion does not claim jurisdiction approval, implemented behavior, successful live smoke, or authority to advance the workflow.

## Definition of done

- Administrators create, hydrate, edit, clear, and set zero through the actual dialog; list and detail views agree after reload.
- Safe maximum values round-trip exactly for 0-, 2-, and 3-digit currencies; malformed, negative, fractional-minor, excess-precision, non-finite, and overflow inputs receive localized errors without mutation.
- Actions and schemas preserve omission versus NULL; legacy currency-less caps remain inspectable and clearable without guesses or silent clearing.
- Public rate schemas and the actual GET response include the cap/currency contract; existing uncapped requests remain valid.
- Composite/regional/period scope is accurately described, and component/project fields remain separate.
- Billing permissions, tenant isolation, and CE/EE migration coverage are verified.
- Automated coverage and live evidence demonstrate that the configured value reaches a real draft invoice, that clearing restores uncapped tax, and that parent uncapped arithmetic remains unchanged.
- User and API documentation, locale keys, plan checklists, and the parent contract reflect the shipped behavior and outstanding domain review.
