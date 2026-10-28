'use client';

import React, { useEffect, useState } from 'react';
import { getInvoiceHistory } from '@alga-psa/billing/actions/invoiceHistoryActions';
import type { InvoiceHistoryEntry } from '@alga-psa/db';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionMessageError, isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';

interface InvoiceHistorySectionProps {
  invoiceId: string;
  /** Bump to reload after an action that changes the invoice lifecycle. */
  refreshKey?: number;
}

/** Minimal lifecycle history: who, what, when and the status change. */
const InvoiceHistorySection: React.FC<InvoiceHistorySectionProps> = ({ invoiceId, refreshKey = 0 }) => {
  const { t } = useTranslation('msp/invoicing');
  const { formatDate } = useFormatters();
  const [entries, setEntries] = useState<InvoiceHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setEntries(null);
    setError(null);
    (async () => {
      try {
        const result = await getInvoiceHistory(invoiceId);
        if (!isMounted) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setError(getErrorMessage(result));
          return;
        }
        setEntries(result);
      } catch (loadError) {
        console.error('Failed to load invoice history', loadError);
        if (isMounted) {
          setError(t('invoicePreview.history.loadFailed', { defaultValue: 'Failed to load invoice history.' }));
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [invoiceId, refreshKey, t]);

  if (error) {
    return <p id="invoice-history-error" className="text-xs text-[rgb(var(--color-text-500))]">{error}</p>;
  }
  if (entries === null) {
    return null;
  }

  const none = t('invoicePreview.history.none', { defaultValue: 'none' });
  return (
    <section id="invoice-history" className="mb-4" aria-label={t('invoicePreview.history.title', { defaultValue: 'History' })}>
      <h3 className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-800))]">
        {t('invoicePreview.history.title', { defaultValue: 'History' })}
      </h3>
      {entries.length === 0 ? (
        <p className="text-xs text-[rgb(var(--color-text-500))]">
          {t('invoicePreview.history.empty', { defaultValue: 'No lifecycle history recorded.' })}
        </p>
      ) : (
        <ul className="space-y-1 text-xs text-[rgb(var(--color-text-700))]">
          {entries.map((entry) => (
            <li key={entry.audit_id} id={`invoice-history-${entry.audit_id}`}>
              <span className="font-medium">
                {t(`invoicePreview.history.ops.${entry.operation}`, { defaultValue: entry.operation })}
              </span>
              {' · '}
              {entry.actor_name ?? t('invoicePreview.history.system', { defaultValue: 'System' })}
              {' · '}
              {formatDate(new Date(entry.timestamp), { dateStyle: 'medium', timeStyle: 'short' })}
              {' · '}
              {t('invoicePreview.history.change', {
                from: entry.before?.status ?? none,
                to: entry.after?.status ?? none,
                defaultValue: '{{from}} → {{to}}',
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default InvoiceHistorySection;
