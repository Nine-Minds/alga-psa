'use client';

import React from 'react';
import { formatCurrency } from '../../../lib/utils/formatters';
import type { InvoicePurchaseOrderSummary } from '../../../lib/actions/invoiceQueries';

export function PurchaseOrderSummaryBanner(props: { poSummary: InvoicePurchaseOrderSummary | null }): React.ReactElement | null {
  const { poSummary } = props;
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
            <span>{formatCurrency(poSummary.po_amount_cents)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">PO Consumed (Finalized)</span>
            <span>{formatCurrency(poSummary.consumed_cents ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">PO Remaining</span>
            <span>{formatCurrency(poSummary.remaining_cents ?? 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

