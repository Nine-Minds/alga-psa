'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  BILLING_FREQUENCY_LABEL_DEFAULTS,
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

export function useContractLineTypeOptions(): LocalizedOption<ContractLineType>[] {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return CONTRACT_LINE_TYPE_VALUES.map((value) => ({
    value,
    label: t(`enums.contractLineType.${value}`, {
      defaultValue: CONTRACT_LINE_TYPE_LABEL_DEFAULTS[value],
    }),
  }));
}

export function useFormatContractLineType(): (value: string) => string {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return (value: string) => {
    const fallback =
      CONTRACT_LINE_TYPE_LABEL_DEFAULTS[value as ContractLineType] ?? value;
    return t(`enums.contractLineType.${value}`, { defaultValue: fallback });
  };
}
