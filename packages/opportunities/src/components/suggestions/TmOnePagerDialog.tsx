'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { PrintableRegion } from '@alga-psa/ui/components/PrintableRegion';
import { PrintButton } from '@alga-psa/ui/components/PrintButton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import type { ITmConversionOnePager } from '@alga-psa/types';
import { getTmConversionOnePager } from '../../actions/generatorActions';

/**
 * The T&M one-pager: the client's own spend, month by month, next to what an
 * agreement costs. Reporting, not selling — printable for the conversation.
 */
export function TmOnePagerDialog({
  suggestionId,
  isOpen,
  onClose,
  onCreateOpportunity,
}: {
  suggestionId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onCreateOpportunity: (suggestionId: string) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<ITmConversionOnePager | null>(null);

  useEffect(() => {
    if (!isOpen || !suggestionId) return;
    let mounted = true;
    setData(null);
    getTmConversionOnePager(suggestionId)
      .then((d) => mounted && setData(d))
      .catch(() => mounted && setData(null));
    return () => {
      mounted = false;
    };
  }, [isOpen, suggestionId]);

  const fmt = (cents: number) => (data ? formatCurrencyFromMinorUnits(cents, undefined, data.currency_code) : '');

  return (
    <Dialog
      id="opportunity-tm-onepager-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('opportunities.onePager.title', 'Time & materials, last 12 months')}
    >
      {!data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-4 pt-1">
          <PrintableRegion title={t('opportunities.onePager.printTitle', '{{client}} — support spend, trailing 12 months', { client: data.client_name })}>
            <p className="mb-3 text-sm text-[rgb(var(--color-text-700))]">
              {t(
                'opportunities.onePager.summary',
                '{{client}} paid {{total}} for hourly support in the last 12 months. That is {{avg}} per month on average.',
                {
                  client: data.client_name,
                  total: fmt(data.trailing_12_total_cents),
                  avg: fmt(data.monthly_avg_cents),
                }
              )}
            </p>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[rgb(var(--color-border-200))] text-left">
                  <th className="py-1.5 pr-4 font-semibold text-[rgb(var(--color-text-700))]">
                    {t('opportunities.onePager.month', 'Month')}
                  </th>
                  <th className="py-1.5 text-right font-semibold text-[rgb(var(--color-text-700))]">
                    {t('opportunities.onePager.billed', 'Billed')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.monthly_totals.map((bucket) => (
                  <tr key={bucket.month} className="border-b border-[rgb(var(--color-border-100,241_245_249))] last:border-b-0">
                    <td className="py-1 pr-4 font-mono text-[12px] text-[rgb(var(--color-text-500))]">{bucket.month}</td>
                    <td className="py-1 text-right tabular-nums text-[rgb(var(--color-text-900))]">
                      {fmt(bucket.total_cents)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-1.5 pr-4 font-semibold text-[rgb(var(--color-text-900))]">
                    {t('opportunities.onePager.average', 'Monthly average')}
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-[rgb(var(--color-text-900))]">
                    {fmt(data.monthly_avg_cents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </PrintableRegion>
          <div className="flex justify-end gap-2">
            <PrintButton id="opportunity-tm-onepager-print" size="sm" variant="outline" />
            <Button
              id="opportunity-tm-onepager-accept"
              size="sm"
              onClick={() => suggestionId && onCreateOpportunity(suggestionId)}
            >
              {t('opportunities.suggestions.accept', 'Create opportunity')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
