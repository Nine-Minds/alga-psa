'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * Shown beside InvoiceSyncBadge while an invoice carries a provisional number and
 * is waiting for the accounting system (Xero) to assign the real one. Such an
 * invoice cannot be emailed or shown in the client portal yet.
 */
export function InvoiceNumberPendingBadge({ invoiceNumberSource }: { invoiceNumberSource?: string | null }) {
  const { t } = useTranslation('msp/invoicing');
  if (invoiceNumberSource !== 'pending_external') {
    return null;
  }
  return (
    <Badge variant="warning" id="invoice-number-pending-badge">
      {t('invoiceSyncBadge.numberPending', { defaultValue: 'Number pending from Xero' })}
    </Badge>
  );
}
