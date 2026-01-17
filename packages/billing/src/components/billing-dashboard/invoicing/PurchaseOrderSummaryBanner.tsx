'use client';

import React from 'react';
import { formatCurrencyFromMinorUnits } from 'server/src/lib/utils/formatters';
import type { InvoicePurchaseOrderSummary } from '@alga-psa/billing/actions/invoiceQueries';

export function PurchaseOrderSummaryBanner(props: {
  poSummary: InvoicePurchaseOrderSummary | null;
  currencyCode?: string;
}): React.ReactElement | null {
  const { poSummary, currencyCode = 'USD' } = props;
  if (!poSummary?.po_number && poSummary?.po_amount_cents == null) {
    return null;
  }

  return (
    <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      {poSummary?.po_number && (
        <div className="flex items-center justify-between">
          <span className="font-medium">PO Number</span>
          <span>{poSummary.po_number}</span>
        </div>
      )}
      {poSummary?.po_amount_cents != null && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium">PO Authorized</span>
            <span>{formatCurrencyFromMinorUnits(poSummary.po_amount_cents, 'en-US', currencyCode)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">PO Consumed (Finalized)</span>
            <span>{formatCurrencyFromMinorUnits(poSummary.consumed_cents ?? 0, 'en-US', currencyCode)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">PO Remaining</span>
            <span>{formatCurrencyFromMinorUnits(poSummary.remaining_cents ?? 0, 'en-US', currencyCode)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
