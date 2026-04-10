# Scratchpad — MSP i18n: Billing Dashboard Sub-batch

- Plan slug: `2026-04-09-msp-i18n-billing-dashboard`
- Created: `2026-04-09`

## What This Is

Create a new `msp/billing` namespace and wire 17 top-level billing dashboard components that
currently have zero i18n coverage. These are the "shell" components -- the main dashboard
container, overview, usage tracking, reconciliation, line items, contract line services,
accounting exports, and template rendering. Sub-batches for contracts, quotes, invoicing,
credits, and service catalog are handled in separate plans.

## Decisions

- **(2026-04-09)** New namespace `msp/billing` rather than extending `features/billing`.
  Rationale: `features/billing` is used by client-portal components and loaded on
  `/client-portal/billing`. MSP billing has a much larger surface area with different
  terminology (reconciliation, contract lines, accounting exports, etc.). Keeping them
  separate avoids loading ~475 MSP-only keys on the client portal.
- **(2026-04-09)** Use `t('key', { defaultValue: 'English fallback' })` pattern consistently
  across all components. This matches the established pattern in the codebase.
- **(2026-04-09)** Import pattern: `import { useTranslation } from '@alga-psa/ui/lib/i18n/client'`
  and `import { useFormatters } from '@alga-psa/ui/lib/i18n/client'` for currency/date formatting.
- **(2026-04-09)** `billingTabsConfig.ts` is a plain TypeScript file (not a React component),
  so it cannot call `useTranslation()` directly. Options: (a) store translation keys in the
  config and translate in the consuming component, or (b) convert to a hook that returns
  translated definitions. Option (a) is simpler and consistent with how the config is used.
  Decision: store `labelKey` alongside `label` in the config, translate in the tab rendering
  component using `t(tab.labelKey, { defaultValue: tab.label })`.
- **(2026-04-09)** `TemplateRendererCore.ts` is a pure function (not a React component), so
  it cannot use hooks. The strings it outputs (`N/A`, `Unknown value`, `No data for list`,
  `Uncategorized`) appear in rendered invoice HTML, not in the dashboard UI chrome. These
  should be audited but likely marked as N/A for this batch -- invoice content localization
  is a separate concern.
- **(2026-04-09)** `TemplateRenderer.tsx` has 3-4 small strings (loading, error, empty state)
  that are proper UI chrome and should be translated.

## Discoveries / Constraints

- **(2026-04-09)** Current `ROUTE_NAMESPACES['/msp/billing']` loads
  `['common', 'msp/core', 'features/billing', 'msp/reports']`. Adding `'msp/billing'` to
  this array is the only config change needed.
- **(2026-04-10)** `server/public/locales/en/msp/billing.json` was created as a broad foundational namespace with shared vocabulary across dashboard, overview, reconciliation, discrepancy, usage, line-item, services, exports, template designer, and quantity-dialog surfaces. It intentionally front-loads reusable labels so later component wiring can reference stable keys instead of inventing ad hoc per-file strings.
- **(2026-04-10)** Locale generation can be bootstrapped from the English namespace using `translate.googleapis.com` while preserving `{{interpolation}}` tokens. This is good enough for parity work, but repeated billing vocabulary still needs spot-auditing because machine translation is not domain-aware (for example, quote/billing terminology can drift).
- **(2026-04-10)** A temporary smoke-test invocation of the locale generator created an unintended `server/public/locales/--help` directory. This was removed before validation; no tracked files depended on it.
- **(2026-04-09)** `ReconciliationResolution.tsx` (1129 LOC) is the largest file and has
  ~80 user-visible strings spanning 3 wizard steps, resolution options, four-eyes approval
  flow, and a confirmation dialog. Split into 3 features (F020-F022).
- **(2026-04-10)** `ReconciliationResolution.tsx` can reuse the already-seeded `reconciliation.steps.*`, `reconciliation.sections.resolutionOptions`, and `reconciliation.resolutionTypes.*` keys without expanding the locale surface. That keeps the first reconciliation wiring pass focused and avoids immediate locale-file churn after F009 validation.
- **(2026-04-09)** `DiscrepancyDetail.tsx` (921 LOC) has ~70 strings and shares many labels
  with ReconciliationResolution (balance comparison, issue types, recommended fix text).
  Key reuse within the namespace will reduce total key count. Split into 3 features (F030-F032).
- **(2026-04-10)** `DiscrepancyDetail.tsx` can share a large chunk of terminology with the reconciliation wizard, but it also has its own `discrepancy.*` card/field/status groups. The first pass is mostly shell labeling; the tab-heavy table content is the riskier part and is better split into separate commits.
- **(2026-04-09)** `LineItem.tsx` (514 LOC) has complex conditional rendering for regular
  items vs discounts (percentage vs fixed). The collapsed/expanded states have different
  label sets. ~40 strings total, split into 2 features (F050-F051).
- **(2026-04-09)** `FixedContractLineServicesList.tsx` and `FixedContractLinePresetServicesList.tsx`
  share nearly identical table structures and add-services UI. Many keys can be shared
  under `contractLineServices.*` group. Preset-specific keys (unsaved changes, save/reset)
  go under `presetServices.*`.
- **(2026-04-09)** `AccountingExportsTab.tsx` uses `react-hot-toast` (not `useToast()`) for
  toast messages. The `toast.success('...')` calls should be wrapped with `t()`.
- **(2026-04-09)** `Overview.tsx` metric cards use a `MetricCard` component that accepts
  `title` and `subtitle` props as strings. These need to become `t()` calls at the
  call site, not inside MetricCard itself (MetricCard is a generic presentational component).
- **(2026-04-10)** `UsageTracking.tsx` already had a clean separation between list-shell strings and dialog/toast strings. That makes it safe to split the i18n pass into F017 (table/filter shell) and F018 (dialog, guidance, toasts) without touching locale structure in between.
- **(2026-04-10)** `LineItem.tsx` can be split cleanly between content labels/summary strings and the remaining chrome-only strings. The existing `lineItem.*` locale group already covers both halves, so F019/F020 do not need additional locale keys unless a hidden string surfaces during test coverage.
- **(2026-04-10)** `FixedContractLineServicesList.tsx` already has a complete `contractLineServices.*` locale group for both the table shell and add-services drawer copy. The only extra reuse needed is `common.notAvailable` / `common.openMenu` for fallback and accessibility labels, so F021/F022 can stay locale-neutral unless a new error state appears.
- **(2026-04-10)** `AccountingExportsTab.tsx` already has enough `accountingExports.*` keys for the card shell and both dialogs, but it does not yet have explicit status-label keys for backend values like `pending`, `delivered`, and `needs_attention`. Those raw status codes are still visible after the first shell pass and need a follow-up before the PRD is truly done.
- **(2026-04-10)** Added discovered follow-up items `F024A` / `T020A` for accounting-export status labels. Rationale: the PRD explicitly calls out status labels, but the original checklist only covered shell/dialog chrome and the namespace did not yet include `accountingExports.status.*` keys.
- **(2026-04-09)** `ContractsHub.tsx` is small (77 LOC) but renders tab labels that should
  use `msp/billing` namespace for consistency with the billing dashboard.
- **(2026-04-09)** `PropertyEditor.tsx` and `ConditionalRuleManager.tsx` are part of the
  invoice template designer. They have few strings (~7 and ~6 respectively) but are
  user-facing UI chrome that should be translated.

## Gotchas

- **billingTabsConfig.ts tab labels** -- these are consumed by `BillingDashboard.tsx` which
  renders them via Radix Tabs. The tab definitions are also used in sidebar navigation.
  Need to verify that all consumers of `billingTabDefinitions` handle the translation key
  pattern correctly.
- **FixedContractLineServicesList Default Rate tooltip** -- uses `<Tooltip>` component with
  complex content. The tooltip text is a sentence about service rate allocation. Translate
  the full sentence as a single key rather than composing from fragments.
- **ReconciliationResolution STEPS constant** -- defined at module scope outside the component.
  Either (a) convert to a function that accepts `t`, or (b) define translated labels inside
  the component and map from STEPS. Option (b) avoids changing the STEPS interface.
- **formatCurrency / formatDateTime** -- these already use locale-aware formatting via
  `@alga-psa/core`. No need to translate their output; they handle locale internally.
- **Discount type options in LineItem.tsx** -- `discountTypeOptions` is defined at module
  scope as a constant array. Same pattern as STEPS -- translate in-component.
- **BILLING_METHOD_OPTIONS** in FixedContractLineServicesList and FixedContractLinePresetServicesList
  -- defined at module scope. Same pattern: translate labels in-component or use `t()` in
  the render callback.
- **(2026-04-10)** The initial English namespace includes some forward-looking keys for later features/tests. As component wiring lands, keep locale parity by updating the real locales and pseudo-locales in lockstep rather than creating one-off English-only keys.

## Key Count Estimate

| Group | Est. Keys |
|-------|-----------|
| dashboard (title, beta, tabs) | ~20 |
| overview (metrics, features, catalog) | ~40 |
| reconciliation (stepper, resolution, approval, confirmation) | ~55 |
| discrepancy (status, tables, issue detail, dialog) | ~50 |
| recommendedFix (panels, dialogs, impact) | ~30 |
| usage (table, form, filters, toasts) | ~40 |
| lineItem (fields, discounts, summary) | ~35 |
| contractLineServices (table, add, actions) | ~30 |
| presetServices (table, unsaved, save/reset) | ~20 |
| accountingExports (table, dialogs) | ~35 |
| templateRenderer/Designer (loading, labels) | ~15 |
| contractsHub (heading, tabs) | ~5 |
| editQuantityDialog (title, validation, buttons) | ~10 |
| **Total** | **~385** |

After key reuse (shared labels like Cancel, Save, Error, etc. from `common` namespace),
the actual `msp/billing.json` key count will likely be ~350-380 unique keys.

## Progress Log

- **(2026-04-10) F001 complete** -- Added `server/public/locales/en/msp/billing.json` with 14 top-level groups (`common`, `dashboard`, `overview`, `reconciliation`, `discrepancy`, `recommendedFix`, `usage`, `lineItem`, `contractLineServices`, `presetServices`, `accountingExports`, `templateRenderer`, `templateDesigner`, `contractsHub`, `editQuantityDialog`, `templateRendererCore`). Verified the file parses with `node -e "JSON.parse(...)"`. This gives the batch a stable namespace before locale generation and component wiring.
- **(2026-04-10) F002 complete** -- Generated `server/public/locales/fr/msp/billing.json` from the English source with placeholder preservation and verified it parses. The first pass is machine-generated; keep an eye on MSP-specific wording during later UI smoke tests.
- **(2026-04-10) F003 complete** -- Generated `server/public/locales/es/msp/billing.json` with the same placeholder-safe pipeline and verified it parses. Locale generation is now quick enough to finish the remaining real locales before component wiring.
- **(2026-04-10) F004 complete** -- Generated `server/public/locales/de/msp/billing.json` and verified it parses. The machine pass works structurally; wording cleanup remains a later QA item, especially for action verbs and billing-domain nouns.
- **(2026-04-10) F005 complete** -- Generated `server/public/locales/nl/msp/billing.json` and verified it parses. The translation endpoint threw one transient 500 during generation; resuming from the on-disk cache completed the locale without losing prior progress.
- **(2026-04-10) F006 complete** -- Generated `server/public/locales/it/msp/billing.json` and verified it parses. The explicit Italian accent audit still needs the global validation pass, but the locale file is now present and structurally correct.
- **(2026-04-10) F007 complete** -- Generated `server/public/locales/pl/msp/billing.json` and verified it parses. At this point all real-language locale files for `msp/billing` exist; pseudo-locales and parity validation are next.
- **(2026-04-10) F008 complete** -- Ran `node scripts/generate-pseudo-locales.cjs`, which regenerated `server/public/locales/xx/msp/billing.json` and `server/public/locales/yy/msp/billing.json` from the English source. Verified both pseudo-locale files now exist.
- **(2026-04-10) F009 complete** -- Ran `node scripts/validate-translations.cjs` after cleaning up the stray `--help` locale directory. Validation passed with 0 errors / 0 warnings across `de`, `es`, `fr`, `it`, `nl`, `pl`, `xx`, and `yy`.
- **(2026-04-10) F010 complete** -- Updated `packages/core/src/lib/i18n/config.ts` so `ROUTE_NAMESPACES['/msp/billing']` now loads `msp/billing` alongside `common`, `msp/core`, `features/billing`, and `msp/reports`. This is the only route-config change needed for this batch.
- **(2026-04-10) F011 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/ReconciliationResolution.tsx` for the stepper labels and the three resolution-type options. The step array now derives labels from `t()` at render time instead of relying on the module-scope English constants.
- **(2026-04-10) F012 complete** -- Continued the `ReconciliationResolution.tsx` pass by translating the discrepancy detail labels (`Client`, `Status`, `Detected`, `Issue Type`), the balance comparison labels, and the two issue-type titles. This kept the commit aligned with the existing `reconciliation.fields.*`, `reconciliation.sections.*`, `reconciliation.status.*`, and `reconciliation.issueTypes.*` key groups.
- **(2026-04-10) F013 complete** -- Finished the main reconciliation wizard shell: four-eyes approval copy, approval verification UI, correction summary labels, confirmation-step summary text, completion dialog copy, and user-facing error messages now read from `msp/billing`. Reused existing namespace keys throughout, so no locale-file regeneration was needed after F009.
- **(2026-04-10) F014 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/DiscrepancyDetail.tsx` for the back navigation text, status badges, discrepancy detail labels, issue-type labels, and balance comparison card labels.
- **(2026-04-10) F015 complete** -- Continued `DiscrepancyDetail.tsx` by translating the transaction-history tab labels, expanded transaction metadata labels, the credit-tracking tab labels, and the credit-entry detail labels/status text. No new locale keys were needed because `discrepancy.tabs.*`, `discrepancy.cards.*`, `discrepancy.fields.*`, `discrepancy.status.*`, and `discrepancy.empty.*` were already seeded in F001.
- **(2026-04-10) F016 complete** -- Finished `DiscrepancyDetail.tsx` by translating the issue-details tab, recommended-fix copy, credit-applications table headings, resolve-discrepancy dialog labels, and the remaining empty/error states. This closes out the discrepancy detail screen without expanding the locale schema beyond the keys already seeded in F001.
- **(2026-04-10) F017 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/UsageTracking.tsx` for the bucket overview title, usage table headers, contract-line summary text, filter labels/placeholders, loading state, and row action menu labels.
- **(2026-04-10) F018 complete** -- Finished `UsageTracking.tsx` by translating the add/edit dialog labels, contract-line selector guidance/placeholder copy, create-update-delete toasts, and the delete confirmation dialog. This closes out the usage-tracking screen without introducing new locale keys after the foundational namespace work.
- **(2026-04-10) F019 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/LineItem.tsx` for the regular field labels, discount field labels, collapsed summary strings, subtotal/discount summaries, and the discount-description placeholder. The file reused the seeded `lineItem.collapsed.*`, `lineItem.fields.*`, `lineItem.placeholders.*`, and `lineItem.summary.*` keys, so locale regeneration was not needed.
- **(2026-04-10) F020 complete** -- Finished `LineItem.tsx` by translating the expanded header labels (`Discount`, `Item {{number}}`, `Marked for removal`), action buttons, discount type select options, the `Entire Invoice` target option, and the percentage-discount “calculated on save” hint. This closes out the top-level line-item editor without expanding the `lineItem.*` locale group.
- **(2026-04-10) F021 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/FixedContractLineServicesList.tsx` for the associated-services table headers, billing-method labels, Product/Service badges, default-rate tooltip, action-menu labels, missing-price cell text, and the small accessibility/fallback strings (`Open menu`, `N/A`, `Unknown Service`). No locale regeneration was needed because the seeded `contractLineServices.*` keys plus `common.*` already covered the table shell.
- **(2026-04-10) F022 complete** -- Finished `FixedContractLineServicesList.tsx` by translating the load/add/remove error messages, loading/empty states, add-services section heading, service metadata rows, product custom-rate label, count-aware add button, and the `Unknown Service` fallback passed into the quantity dialog. This closes out the fixed contract-line services list without adding new locale keys beyond the original `contractLineServices.*` plan.
- **(2026-04-10) F023 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx` for the card title/description, batch table headers, outer action buttons, list loading/empty states, and the list-side execute/load-batches feedback messages. This leaves the create/detail dialogs plus status-label normalization for follow-up commits.
- **(2026-04-10) F024 complete** -- Finished `AccountingExportsTab.tsx` by translating the new-export dialog labels/placeholders/buttons, the batch-detail dialog title/field labels/states, and the create/load-detail feedback messages. The remaining accounting-exports gap is the raw backend status-code display, which is now tracked explicitly as `F024A`.
- **(2026-04-10) F024A complete** -- Added `accountingExports.status.*` keys to the English and six real-language locale files, regenerated pseudo-locales, and mapped `AccountingExportsTab.tsx` batch statuses (`pending`, `validating`, `ready`, `delivered`, `posted`, `failed`, `cancelled`, `needs_attention`) through `t()`. Re-ran `node scripts/generate-pseudo-locales.cjs` and `node scripts/validate-translations.cjs`; validation passed with 0 errors / 0 warnings.
- **(2026-04-10) F025 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/FixedContractLinePresetServicesList.tsx` for the preset table headers, billing-method labels, default-rate tooltip, row action label, unsaved-changes warning, loading text, add-services section title/button, and save/reset button states. Reused `presetServices.*`, `contractLineServices.billingMethods.*`, and `common.*` without expanding the locale schema.
- **(2026-04-10) F026 complete** -- Finished `FixedContractLinePresetServicesList.tsx` by translating the preset empty states, add-list service metadata row, and the navigate-away confirmation dialog. The preset save/load error alerts now flow through translated default messages introduced in the prior pass, so this closes out the preset services manager without new locale keys.
- **(2026-04-10) F027 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/RecommendedFixPanel.tsx` for the card title, panel headings, issue-type-specific descriptions, per-fix button labels, and the field labels embedded in the recommended-fix summaries. Existing `recommendedFix.*`, `reconciliation.fields.*`, and `discrepancy.fields.*` keys were sufficient, so no locale-file update was needed.
- **(2026-04-10) F028 complete** -- Finished `RecommendedFixPanel.tsx` by translating the fix-dialog titles/descriptions, adjustment amount and notes fields, impact-summary labels, resolved-state copy, and dialog/apply error states. This closes out the recommended-fix workflow without further locale changes because the seeded `recommendedFix.dialog.*`, `recommendedFix.impactSummary.*`, `recommendedFix.resolved.*`, and `recommendedFix.errors.*` groups already existed.
- **(2026-04-10) F029 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/Overview.tsx` for the seven metric card titles/subtitles, the Monthly Activity section, and the Service Catalog Management quick-access card. This kept the first Overview pass aligned with the seeded `overview.metrics.*` and `overview.sections.*` keys.
- **(2026-04-10) F030 complete** -- Finished `Overview.tsx` by translating the feature-card grid, the destructive load-error alert, the small metric fallback states (`...`, `Error`, `0`, `0 hours`), and the development-only debug labels. No locale updates were needed because the seeded `overview.features.*`, `overview.errors.*`, `overview.states.*`, and `overview.debug.*` groups already covered the remaining strings.
- **(2026-04-10) F031 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/BillingDashboard.tsx` for the page title, beta banner, error prefix, quote-templates heading, and the back-to-preset navigation text. The component still does not render the tab labels from `billingTabsConfig`, so the separate F033 follow-up remains necessary.
- **(2026-04-10) F032 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/EditContractLineServiceQuantityDialog.tsx` for the interpolated dialog title, quantity label, validation messages, save error fallback, cancel/save buttons, and saving indicator text. No locale changes were needed because `editQuantityDialog.*` already covered the entire dialog surface.
- **(2026-04-10) F033 complete** -- Added `labelKey` to every entry in `packages/billing/src/components/billing-dashboard/billingTabsConfig.ts` and translated the config in `BillingDashboard.tsx` with `t(tab.labelKey, { defaultValue: tab.label })`. `BillingDashboard` still does not render a local `Tabs.List`, but the route now consumes a translated tab-definition model rather than raw English labels.
- **(2026-04-10) F034 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/TemplateRenderer.tsx` for the loading text, destructive error prefix, and empty-state message shown before an invoice/template pair is selected. No locale updates were needed because `templateRenderer.*` already existed.
- **(2026-04-10) F035 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/PropertyEditor.tsx` for the field labels, “Select a field” option, and the generated column/row size captions. The existing `templateDesigner.propertyEditor.*` keys covered the inspector without locale churn.
- **(2026-04-10) F036 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/ConditionalRuleManager.tsx` for the heading, action select options, text-input placeholders, and add-rule button label. The existing `templateDesigner.conditionalRules.*` keys fully covered the component.
- **(2026-04-10) F037 complete** -- Wired `useTranslation('msp/billing')` into `packages/billing/src/components/billing-dashboard/ContractsHub.tsx` for the hub heading and the two sub-tab labels. This closes out the contracts hub chrome with the existing `contractsHub.*` keys.
- **(2026-04-10) F038 complete** -- Audited `packages/billing/src/components/billing-dashboard/TemplateRendererCore.ts` and confirmed its fallback strings (`No data for list`, `Uncategorized`, `N/A`, `Unknown value`) are emitted into generated invoice HTML rather than the billing dashboard shell. Added code comments documenting that boundary instead of forcing dashboard-namespace translation into the pure renderer.
- **(2026-04-10) T001 complete** -- Re-ran `node scripts/generate-pseudo-locales.cjs` and `node scripts/validate-translations.cjs` after the later accounting-export status-key expansion and final feature wiring. Validation still passed with 0 errors / 0 warnings across `de`, `es`, `fr`, `it`, `nl`, `pl`, `xx`, and `yy`, so locale parity remains intact after the full feature set.
- **(2026-04-10) T002 complete** -- Added `packages/billing/tests/billing-dashboard/ReconciliationResolution.i18n.test.ts` and verified, under `packages/billing`’s Vitest config, that the stepper labels are wired through `msp/billing` and backed by pseudo-locale keys. Command used: `npm exec -- vitest --root packages/billing --config vitest.config.ts run tests/billing-dashboard/ReconciliationResolution.i18n.test.ts`.
- **(2026-04-10) T003 complete** -- Extended the same ReconciliationResolution audit test to cover the three resolution-option labels (`Recommended Fix`, `Custom Correction`, `No Action Required`) and verified the updated file passes under the billing package Vitest config.
- **(2026-04-10) T004 complete** -- Extended the ReconciliationResolution audit to cover the translated balance-comparison labels and the four-eyes approval copy (`requiredTitle`, `requiredDescription`, approver fields, verification code, verified badge title). The billing-package Vitest run remained green.
- **(2026-04-10) T005 complete** -- Extended the ReconciliationResolution audit to cover the confirmation-step copy (`importantTitle`, `importantDescription`, confirm/close buttons, thank-you title) and the key reconciliation error messages. The shared audit file still passed under the billing-package Vitest config.

## Runbook

- `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/billing.json','utf8')); console.log('ok')"`
- `node - <<'NODE' ... generate translated locale from en/msp/billing.json via translate.googleapis.com while preserving {{placeholders}} ... NODE`
- `node scripts/generate-pseudo-locales.cjs`
- `rm -rf server/public/locales/--help && node scripts/validate-translations.cjs`
- `npm exec eslint -- packages/billing/src/components/billing-dashboard/LineItem.tsx`
- `npm exec eslint -- packages/billing/src/components/billing-dashboard/FixedContractLineServicesList.tsx`
- `npm exec eslint -- packages/billing/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`
