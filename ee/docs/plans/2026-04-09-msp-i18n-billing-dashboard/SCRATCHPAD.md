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
- **(2026-04-09)** `ReconciliationResolution.tsx` (1129 LOC) is the largest file and has
  ~80 user-visible strings spanning 3 wizard steps, resolution options, four-eyes approval
  flow, and a confirmation dialog. Split into 3 features (F020-F022).
- **(2026-04-09)** `DiscrepancyDetail.tsx` (921 LOC) has ~70 strings and shares many labels
  with ReconciliationResolution (balance comparison, issue types, recommended fix text).
  Key reuse within the namespace will reduce total key count. Split into 3 features (F030-F032).
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
