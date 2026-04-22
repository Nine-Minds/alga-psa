'use client';

import React from 'react';
import type { InvoicePurchaseOrderSummary } from '@alga-psa/billing/actions/invoiceQueries';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function PurchaseOrderSummaryBanner(props: {
  poSummary: InvoicePurchaseOrderSummary | null;
  currencyCode?: string;
}): React.ReactElement | null {
  const { t } = useTranslation('msp/invoicing');
  const { formatCurrency } = useFormatters();
  const { poSummary, currencyCode = 'USD' } = props;
  if (!poSummary?.po_number && poSummary?.po_amount_cents == null) {
    return null;
  }

  return (
    <Alert variant="warning" className="mb-4">
      <AlertDescription className="text-sm">
        {poSummary?.po_number && (
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {t('purchaseOrder.labels.number', { defaultValue: 'PO Number' })}
            </span>
            <span>{poSummary.po_number}</span>
          </div>
        )}
        {poSummary?.po_amount_cents != null && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {t('purchaseOrder.labels.authorized', { defaultValue: 'PO Authorized' })}
              </span>
              <span>{formatCurrency(poSummary.po_amount_cents / 100, currencyCode)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {t('purchaseOrder.labels.consumed', { defaultValue: 'PO Consumed (Finalized)' })}
              </span>
              <span>{formatCurrency((poSummary.consumed_cents ?? 0) / 100, currencyCode)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {t('purchaseOrder.labels.remaining', { defaultValue: 'PO Remaining' })}
              </span>
              <span>{formatCurrency((poSummary.remaining_cents ?? 0) / 100, currencyCode)}</span>
            </div>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
