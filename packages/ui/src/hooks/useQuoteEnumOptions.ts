'use client';

import { useTranslation } from '../lib/i18n/client';
import {
  QUOTE_STATUS_DESCRIPTION_DEFAULTS,
  QUOTE_STATUS_LABEL_DEFAULTS,
  QUOTE_STATUS_VALUES,
  type QuoteStatus,
} from '@alga-psa/types';

const BILLING_NAMESPACE = 'features/billing';

export interface QuoteStatusOption {
  value: QuoteStatus;
  label: string;
}

export function useQuoteStatusOptions(): QuoteStatusOption[] {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return QUOTE_STATUS_VALUES.map((value) => ({
    value,
    label: t(`enums.quoteStatus.${value}`, {
      defaultValue: QUOTE_STATUS_LABEL_DEFAULTS[value],
    }),
  }));
}

export function useFormatQuoteStatus(): (value: string) => string {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return (value: string) => {
    const fallback =
      QUOTE_STATUS_LABEL_DEFAULTS[value as QuoteStatus] ?? value;
    return t(`enums.quoteStatus.${value}`, { defaultValue: fallback });
  };
}

export function useFormatQuoteStatusDescription(): (value: string) => string {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return (value: string) => {
    const fallback =
      QUOTE_STATUS_DESCRIPTION_DEFAULTS[value as QuoteStatus] ?? '';
    return t(`enums.quoteStatusDescription.${value}`, { defaultValue: fallback });
  };
}
