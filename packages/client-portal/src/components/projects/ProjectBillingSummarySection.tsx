'use client';

import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import {
  getClientProjectBillingSummary,
  type ClientProjectBillingSummary,
} from '@alga-psa/client-portal/actions';

interface ProjectBillingSummarySectionProps {
  projectId: string;
}

// Read-only billing summary for the client portal. Renders nothing unless the MSP
// has enabled `show_billing` for this project and a billing config exists.
export default function ProjectBillingSummarySection({ projectId }: ProjectBillingSummarySectionProps) {
  const { t } = useTranslation('features/projects');
  const { formatCurrency } = useFormatters();
  const [summary, setSummary] = useState<ClientProjectBillingSummary | null>(null);

  useEffect(() => {
    let active = true;
    getClientProjectBillingSummary(projectId)
      .then((result) => { if (active) setSummary(result); })
      .catch((error) => { console.error('Error fetching project billing summary:', error); });
    return () => { active = false; };
  }, [projectId]);

  if (!summary || !summary.enabled) return null;

  const money = (cents: number) => formatCurrency(cents / 100, 'USD', { minimumFractionDigits: 2 });

  return (
    <div className="bg-white rounded-lg shadow" id="client-portal-project-billing">
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold">{t('billing.title', 'Billing')}</h3>
      </div>
      <div className="p-4 space-y-4">
        {/* Totals */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {summary.total_price !== null && (
            <div>
              <p className="text-sm text-gray-600">{t('billing.totalPrice', 'Total Price')}</p>
              <p className="font-medium">{money(summary.total_price)}</p>
            </div>
          )}
          <div>
            <p className="text-sm text-gray-600">{t('billing.invoicedToDate', 'Invoiced to Date')}</p>
            <p className="font-medium">{money(summary.invoiced_to_date)}</p>
          </div>
        </div>

        {/* Schedule */}
        {summary.entries.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              {t('billing.paymentSchedule', 'Payment Schedule')}
            </p>
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-md">
              {summary.entries.map((entry, index) => (
                <li key={index} className="flex items-center justify-between gap-4 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{entry.description}</p>
                    {entry.status === 'invoiced' && entry.invoiced_at && (
                      <p className="text-xs text-gray-500">
                        {t('billing.invoicedOn', 'Invoiced {{date}}', {
                          date: format(new Date(entry.invoiced_at), 'PP'),
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-medium text-gray-900">{money(entry.computed_amount)}</span>
                    {entry.status === 'invoiced' ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                        {t('billing.status.invoiced', 'Invoiced')}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {t('billing.status.upcoming', 'Upcoming')}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
