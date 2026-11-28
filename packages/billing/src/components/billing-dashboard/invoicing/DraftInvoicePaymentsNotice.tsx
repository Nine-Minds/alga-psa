'use client';

import React, { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getInvoicePaymentSummary,
  type InvoicePaymentSummary,
} from '@alga-psa/billing/actions/invoicePaymentActions';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { computeBalanceDue } from '../../../lib/balanceDue';

interface DraftInvoicePaymentsNoticeProps {
  invoiceId: string;
  /** Bump to reload the summary after the draft total changes. */
  refreshKey?: number;
}

/**
 * Payments survive unfinalize, so a draft can carry recorded payments.
 * Shows the net amount paid and warns when the draft total is below it
 * (finalizing then leaves the invoice overpaid). alga-2026-0003329
 *
 * Silent when the summary is unavailable (e.g. the user lacks invoice:payment).
 */
const DraftInvoicePaymentsNotice: React.FC<DraftInvoicePaymentsNoticeProps> = ({ invoiceId, refreshKey = 0 }) => {
  const { t } = useTranslation('msp/invoicing');
  const { locale } = useFormatters();
  const [summary, setSummary] = useState<InvoicePaymentSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getInvoicePaymentSummary(invoiceId);
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setSummary(null);
          return;
        }
        setSummary(result);
      } catch {
        if (!cancelled) setSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, refreshKey]);

  if (!summary || summary.totalPaid <= 0) return null;

  const format = (minor: number) => formatCurrencyFromMinorUnits(minor, locale, summary.currencyCode);
  const overpaid = computeBalanceDue({
    totalAmount: summary.totalAmount,
    creditApplied: summary.creditApplied,
    totalPaid: summary.totalPaid,
  }) < 0;

  return (
    <div className="mb-4 space-y-2" id="draft-invoice-payments-notice">
      <Alert variant="info" id="draft-invoice-amount-paid">
        <AlertDescription>
          {t('draftInvoicePayments.amountPaid', {
            defaultValue: 'Payments of {{amount}} are recorded against this invoice.',
            amount: format(summary.totalPaid),
          })}
        </AlertDescription>
      </Alert>
      {overpaid ? (
        <Alert variant="warning" id="draft-invoice-overpaid-warning">
          <AlertDescription>
            {t('draftInvoicePayments.overpaidWarning', {
              defaultValue:
                'The draft total is below the amount already paid ({{paid}}). Finalizing will leave this invoice overpaid.',
              paid: format(summary.totalPaid),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};

export default DraftInvoicePaymentsNotice;
