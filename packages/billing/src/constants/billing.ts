/**
 * Shared billing enums.
 *
 * Label-localized option lists live in `packages/billing/src/hooks/useBillingEnumOptions.ts`.
 * See `.ai/translation/enum-labels-pattern.md` for the rationale.
 *
 * The `*_DISPLAY` / `*_OPTIONS` exports below are preserved for backwards compatibility
 * with consumers that have not yet been migrated to the hook pattern. They ship hardcoded
 * English strings and bypass `t()`, so **do not import them into new code**.
 */

export const CONTRACT_LINE_TYPE_VALUES = ['Fixed', 'Hourly', 'Usage'] as const;
export type ContractLineType = (typeof CONTRACT_LINE_TYPE_VALUES)[number];

export const BILLING_FREQUENCY_VALUES = ['weekly', 'monthly', 'quarterly', 'annually'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCY_VALUES)[number];

/**
 * English fallbacks for {@link CONTRACT_LINE_TYPE_VALUES}. Consumed as `defaultValue`
 * by `useContractLineTypeOptions` / `useFormatContractLineType` so the UI stays readable
 * when the `features/billing` namespace has not loaded yet.
 */
export const CONTRACT_LINE_TYPE_LABEL_DEFAULTS: Record<ContractLineType, string> = {
  Fixed: 'Fixed',
  Hourly: 'Hourly',
  Usage: 'Usage Based',
};

/**
 * English fallbacks for {@link BILLING_FREQUENCY_VALUES}. Consumed as `defaultValue`
 * by `useBillingFrequencyOptions` / `useFormatBillingFrequency`.
 */
export const BILLING_FREQUENCY_LABEL_DEFAULTS: Record<BillingFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
};

/**
 * @deprecated Hardcoded English. Use `useContractLineTypeOptions` / `useFormatContractLineType`
 * from `@alga-psa/billing/hooks/useBillingEnumOptions` instead.
 */
export const CONTRACT_LINE_TYPE_DISPLAY: Record<string, string> = {
  ...CONTRACT_LINE_TYPE_LABEL_DEFAULTS,
};

/**
 * @deprecated Hardcoded English. Use `useContractLineTypeOptions` from
 * `@alga-psa/billing/hooks/useBillingEnumOptions` instead.
 */
export const CONTRACT_LINE_TYPE_OPTIONS = Object.entries(CONTRACT_LINE_TYPE_DISPLAY).map(([value, label]) => ({
  value,
  label,
}));

/**
 * @deprecated Backwards-compat alias for {@link CONTRACT_LINE_TYPE_DISPLAY}.
 */
export const PLAN_TYPE_DISPLAY = CONTRACT_LINE_TYPE_DISPLAY;

/**
 * @deprecated Backwards-compat alias for {@link CONTRACT_LINE_TYPE_OPTIONS}.
 */
export const PLAN_TYPE_OPTIONS = CONTRACT_LINE_TYPE_OPTIONS;

/**
 * @deprecated Hardcoded English. Use `useBillingFrequencyOptions` / `useFormatBillingFrequency`
 * from `@alga-psa/billing/hooks/useBillingEnumOptions` instead.
 */
export const BILLING_FREQUENCY_DISPLAY: Record<string, string> = {
  ...BILLING_FREQUENCY_LABEL_DEFAULTS,
};

/**
 * @deprecated Hardcoded English. Use `useBillingFrequencyOptions` from
 * `@alga-psa/billing/hooks/useBillingEnumOptions` instead.
 */
export const BILLING_FREQUENCY_OPTIONS = Object.entries(BILLING_FREQUENCY_DISPLAY).map(([value, label]) => ({
  value,
  label,
}));
