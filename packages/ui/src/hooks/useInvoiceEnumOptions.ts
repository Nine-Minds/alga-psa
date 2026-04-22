'use client';

import { useTranslation } from '../lib/i18n/client';
import {
  INVOICE_STATUS_DESCRIPTION_DEFAULTS,
  INVOICE_STATUS_LABEL_DEFAULTS,
  INVOICE_STATUS_VALUES,
  type InvoiceStatus,
} from '@alga-psa/types';

const BILLING_NAMESPACE = 'features/billing';

export interface InvoiceStatusOption {
  value: InvoiceStatus;
  label: string;
}

export function useInvoiceStatusOptions(
  order: ReadonlyArray<InvoiceStatus> = INVOICE_STATUS_VALUES,
): InvoiceStatusOption[] {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return order.map((value) => ({
    value,
    label: t(`enums.invoiceStatus.${value}`, {
      defaultValue: INVOICE_STATUS_LABEL_DEFAULTS[value],
    }),
  }));
}

export function useFormatInvoiceStatus(): (value: string) => string {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return (value: string) => {
    const fallback =
      INVOICE_STATUS_LABEL_DEFAULTS[value as InvoiceStatus] ?? value;
    return t(`enums.invoiceStatus.${value}`, { defaultValue: fallback });
  };
}

export function useFormatInvoiceStatusDescription(): (value: string) => string {
  const { t } = useTranslation(BILLING_NAMESPACE);
  return (value: string) => {
    const fallback =
      INVOICE_STATUS_DESCRIPTION_DEFAULTS[value as InvoiceStatus] ?? '';
    return t(`enums.invoiceStatusDescription.${value}`, { defaultValue: fallback });
  };
}
