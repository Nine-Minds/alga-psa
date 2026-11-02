'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { canonicalRecurringFrequency } from '@alga-psa/shared/billingClients/recurringMemberRate';
import {
  BILLING_FREQUENCY_LABEL_DEFAULTS,
  BILLING_PERIOD_LABEL_DEFAULTS,
  BILLING_FREQUENCY_VALUES,
  CONTRACT_LINE_TYPE_LABEL_DEFAULTS,
  CONTRACT_LINE_TYPE_VALUES,
  type BillingFrequency,
  type ContractLineType,
} from '../constants/billing';

const BILLING_NAMESPACE = 'features/billing';

export interface LocalizedOption<V extends string> {
  value: V;
  label: string;
}

export function useBillingFrequencyOptions(): LocalizedOption<BillingFrequency>[] {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return BILLING_FREQUENCY_VALUES.map((value) => ({
    value,
    label: t(`enums.billingFrequency.${value}`, {
      defaultValue: BILLING_FREQUENCY_LABEL_DEFAULTS[value],
    }),
  }));
}

export function useFormatBillingFrequency(): (value: string) => string {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return (value: string) => {
    const fallback =
      BILLING_FREQUENCY_LABEL_DEFAULTS[value as BillingFrequency] ?? value;
    return t(`enums.billingFrequency.${value}`, { defaultValue: fallback });
  };
}

/**
 * A cadence as the period an amount covers ("per year", "per month"), for
 * printing after a per-period amount. Accepts any stored spelling; null and
 * unknown cadences read as monthly, the same rule the monthly normalization uses.
 */
export function useFormatBillingPeriod(): (value: string | null | undefined) => string {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return (value) => {
    const frequency = canonicalRecurringFrequency(value);
    return t(`enums.billingPeriod.${frequency}`, { defaultValue: BILLING_PERIOD_LABEL_DEFAULTS[frequency] });
  };
}

export function useContractLineTypeOptions(): LocalizedOption<ContractLineType>[] {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return CONTRACT_LINE_TYPE_VALUES.map((value) => ({
    value,
    label: t(`enums.contractLineType.${value}`, {
      defaultValue: CONTRACT_LINE_TYPE_LABEL_DEFAULTS[value],
    }),
  }));
}

/**
 * Derived display kinds that are not stored contract_line_type values. A Prepaid
 * Block line is stored as 'Hourly'; getDetailedContractLines reports 'PrepaidBlock'
 * as its display_kind so labels can distinguish it without a new enum value.
 */
const DERIVED_CONTRACT_LINE_KIND_LABEL_DEFAULTS: Record<string, string> = {
  PrepaidBlock: 'Prepaid Block',
};

export function useFormatContractLineType(): (value: string) => string {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return (value: string) => {
    const fallback =
      CONTRACT_LINE_TYPE_LABEL_DEFAULTS[value as ContractLineType]
      ?? DERIVED_CONTRACT_LINE_KIND_LABEL_DEFAULTS[value]
      ?? value;
    return t(`enums.contractLineType.${value}`, { defaultValue: fallback });
  };
}
